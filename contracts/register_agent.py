"""
Register an agent on the AgentGuard policy contract (calls the
`create_agent` ABI method). Admin (deployer) signs the call — it's the
only key allowed by the contract.

Typical usage
-------------

    # Register the deployer's own wallet as the demo agent (default)
    python contracts/register_agent.py

    # Register a different agent, override caps + threshold
    python contracts/register_agent.py \\
        --agent RIQP...NEVQ \\
        --daily 200000 --monthly 2000000 --threshold 50000 \\
        --routes "POST /llm/summarize,POST /gpu/render"

Amounts are in micro-USDC (1 USDC = 1_000_000).

Environment (loaded from contracts/.env)
----------------------------------------

    DEPLOYER_MNEMONIC   25-word Algorand OR 24-word BIP-39 (Pera). Required.
    ACCOUNT_INDEX       BIP-39 HD account. Optional, default 0.
    ALGOD_URL           Algorand algod endpoint. Optional, defaults to algonode.
    ALGOD_TOKEN         Algod bearer token. Optional (empty for algonode).
    POLICY_APP_ID       Deployed contract app id. Optional; falls back to
                        the app_id recorded in contracts/build/deployment.json
                        by `contracts/deploy.py`.

Idempotency
-----------

The contract's `create_agent` asserts `App.box_create(...)`, which fails
on a second call for the same agent because the box already exists.
This script detects that condition BEFORE submitting a transaction and
exits cleanly (exit code 0, "already registered") instead of burning
fees for a guaranteed-to-revert app call. Use `--force-update` to route
through `update_policy` instead when caps need to change.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import pathlib
import sys
from typing import Optional

from algosdk import constants, encoding as algo_encoding, transaction
from algosdk.v2client import algod
from dotenv import load_dotenv

from wallet import load_wallet, sign_txn_bytes

load_dotenv(pathlib.Path(__file__).parent / ".env")


# ── ABI helpers ─────────────────────────────────────────────────────

def _abi_selector(method_sig: str) -> bytes:
    """ARC-4 method selector = first 4 bytes of SHA-512/256(signature)."""
    from Cryptodome.Hash import SHA512

    h = SHA512.new(truncate="256")
    h.update(method_sig.encode())
    return h.digest()[:4]


CREATE_AGENT_SIG = "create_agent(address,uint64,uint64,uint64,string)void"
UPDATE_POLICY_SIG = "update_policy(address,uint64,uint64,uint64)void"
CREATE_AGENT_SELECTOR = _abi_selector(CREATE_AGENT_SIG)
UPDATE_POLICY_SELECTOR = _abi_selector(UPDATE_POLICY_SIG)


def _abi_uint64(n: int) -> bytes:
    return n.to_bytes(8, "big")


def _abi_string(s: str) -> bytes:
    body = s.encode()
    return len(body).to_bytes(2, "big") + body


# ── Env + deployment loaders (fail loud with clear messages) ────────

def _load_policy_app_id() -> int:
    """Prefer POLICY_APP_ID env; fall back to build/deployment.json."""
    env_id = os.environ.get("POLICY_APP_ID", "").strip()
    if env_id:
        try:
            return int(env_id)
        except ValueError:
            raise SystemExit(f"POLICY_APP_ID env is not an integer: {env_id!r}")

    dep = pathlib.Path(__file__).parent / "build" / "deployment.json"
    if not dep.exists():
        raise SystemExit(
            "No POLICY_APP_ID in env and no contracts/build/deployment.json.\n"
            "Either set POLICY_APP_ID in contracts/.env, or run:\n"
            "    python contracts/deploy.py"
        )
    try:
        data = json.loads(dep.read_text())
        return int(data["app_id"])
    except (json.JSONDecodeError, KeyError, ValueError) as exc:
        raise SystemExit(f"deployment.json malformed: {exc}") from exc


def _require_env(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        raise SystemExit(
            f"{name} missing — put it in contracts/.env "
            f"(see contracts/.env.example)"
        )
    return val


# ── Idempotency check ───────────────────────────────────────────────

def is_agent_registered(client: algod.AlgodClient, app_id: int, agent_addr: str) -> bool:
    """Return True if the agent's box exists on the contract."""
    box_name = algo_encoding.decode_address(agent_addr)  # 32-byte pubkey
    try:
        client.application_box_by_name(app_id, box_name)
        return True
    except Exception as exc:
        # py-algorand-sdk raises AlgodHTTPError with 404 for missing boxes.
        msg = str(exc).lower()
        if "box not found" in msg or "404" in msg or "not exist" in msg:
            return False
        # Anything else is a real error — surface it.
        raise


# ── Transaction builders ────────────────────────────────────────────

def build_create_agent_appcall(
    admin_addr: str,
    agent_addr: str,
    daily_cap: int,
    monthly_cap: int,
    human_threshold: int,
    routes_csv: str,
    app_id: int,
    sp: transaction.SuggestedParams,
) -> transaction.ApplicationNoOpTxn:
    agent_pk = algo_encoding.decode_address(agent_addr)  # 32 bytes
    routes_nl = "\n".join(r.strip() for r in routes_csv.split(",") if r.strip())
    app_args = [
        CREATE_AGENT_SELECTOR,
        agent_pk,
        _abi_uint64(daily_cap),
        _abi_uint64(monthly_cap),
        _abi_uint64(human_threshold),
        _abi_string(routes_nl),
    ]
    return transaction.ApplicationNoOpTxn(
        sender=admin_addr,
        sp=sp,
        index=app_id,
        app_args=app_args,
        boxes=[(app_id, agent_pk)],
    )


def build_update_policy_appcall(
    admin_addr: str,
    agent_addr: str,
    daily_cap: int,
    monthly_cap: int,
    human_threshold: int,
    app_id: int,
    sp: transaction.SuggestedParams,
) -> transaction.ApplicationNoOpTxn:
    agent_pk = algo_encoding.decode_address(agent_addr)
    app_args = [
        UPDATE_POLICY_SELECTOR,
        agent_pk,
        _abi_uint64(daily_cap),
        _abi_uint64(monthly_cap),
        _abi_uint64(human_threshold),
    ]
    return transaction.ApplicationNoOpTxn(
        sender=admin_addr,
        sp=sp,
        index=app_id,
        app_args=app_args,
        boxes=[(app_id, agent_pk)],
    )


def _sign(wallet, txn: transaction.Transaction) -> transaction.SignedTransaction:
    prefixed = constants.txid_prefix + base64.b64decode(algo_encoding.msgpack_encode(txn))
    sig = sign_txn_bytes(wallet, prefixed)
    return transaction.SignedTransaction(txn, base64.b64encode(sig).decode())


# ── CLI ─────────────────────────────────────────────────────────────

def _parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Register an agent (or update its policy) on the AgentGuard contract.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument(
        "--agent",
        help="58-char Algorand address to register. "
        "Defaults to the deployer's own address (matches the demo setup).",
    )
    p.add_argument("--daily", type=int, default=200_000, help="daily cap micro-USDC (default $0.20)")
    p.add_argument("--monthly", type=int, default=2_000_000, help="monthly cap micro-USDC (default $2.00)")
    p.add_argument("--threshold", type=int, default=50_000, help="human threshold micro-USDC (default $0.05)")
    p.add_argument(
        "--routes",
        default="POST /llm/summarize,POST /gpu/render",
        help="comma-separated route allow-list",
    )
    p.add_argument(
        "--force-update",
        action="store_true",
        help="If the agent is already registered, call update_policy instead of exiting.",
    )
    p.add_argument(
        "--check-only",
        action="store_true",
        help="Only check whether the agent is registered; do not submit any transaction.",
    )
    return p.parse_args(argv)


def main() -> int:
    args = _parse_args()

    mnemonic = _require_env("DEPLOYER_MNEMONIC")
    account_index = int(os.environ.get("ACCOUNT_INDEX", "0"))
    algod_url = os.environ.get("ALGOD_URL", "https://testnet-api.algonode.cloud")
    algod_token = os.environ.get("ALGOD_TOKEN", "")

    app_id = _load_policy_app_id()

    admin = load_wallet(mnemonic, account_index=account_index)
    agent_addr = (args.agent or admin.address).strip()

    if len(agent_addr) != 58:
        raise SystemExit(f"agent address must be 58 chars, got {len(agent_addr)}")

    print(f"admin       : {admin.address}  ({admin.format})")
    print(f"agent       : {agent_addr}")
    print(f"app id      : {app_id}")
    print(f"caps        : daily={args.daily} monthly={args.monthly} threshold={args.threshold}")
    print(f"routes      : {args.routes}")

    client = algod.AlgodClient(algod_token, algod_url)

    # ── Idempotency check ─────────────────────────────────────────
    already = is_agent_registered(client, app_id, agent_addr)
    if args.check_only:
        print(f"status      : {'REGISTERED' if already else 'NOT_REGISTERED'}")
        return 0

    if already and not args.force_update:
        print("status      : already registered — box exists on chain.")
        print("             re-run with --force-update to change caps via update_policy.")
        return 0

    # ── Admin must be funded ──────────────────────────────────────
    info = client.account_info(admin.address)
    algo_balance = info["amount"] / 1e6
    if algo_balance < 0.05:
        raise SystemExit(
            f"admin has {algo_balance} ALGO — need at least ~0.05 to cover txn fee "
            f"and (on create) box min-balance."
        )

    # ── Build + sign + submit ─────────────────────────────────────
    sp = client.suggested_params()
    if already and args.force_update:
        print("mode        : update_policy")
        txn = build_update_policy_appcall(
            admin.address,
            agent_addr,
            args.daily,
            args.monthly,
            args.threshold,
            app_id,
            sp,
        )
    else:
        print("mode        : create_agent")
        txn = build_create_agent_appcall(
            admin.address,
            agent_addr,
            args.daily,
            args.monthly,
            args.threshold,
            args.routes,
            app_id,
            sp,
        )

    signed = _sign(admin, txn)
    tx_id = client.send_transaction(signed)
    print(f"submitted   : {tx_id}")

    result = transaction.wait_for_confirmation(client, tx_id, 10)
    print(f"confirmed   : round {result['confirmed-round']}")
    print(f"logs        : {result.get('logs', [])}")
    print(f"status      : SUCCESS")
    print(f"lora tx     : https://lora.algokit.io/testnet/tx/{tx_id}")
    print(f"lora app    : https://lora.algokit.io/testnet/application/{app_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
