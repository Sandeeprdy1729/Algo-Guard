"""
Register an agent on the policy contract (calls create_agent).

    python contracts/register_agent.py <agent_addr> \\
        --daily 200000 --monthly 2000000 --threshold 50000 \\
        --routes "POST /llm/summarize,POST /gpu/render"

Amounts are in micro-USDC (1 USDC = 1_000_000). The admin (deployer)
signs the call — it's the only key allowed by the contract.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import pathlib

from algosdk import constants, encoding as algo_encoding, transaction
from algosdk.v2client import algod
from dotenv import load_dotenv

from wallet import load_wallet, sign_txn_bytes

load_dotenv()

DEPLOYMENT = json.loads((pathlib.Path(__file__).parent / "build" / "deployment.json").read_text())
APP_ID = DEPLOYMENT["app_id"]

CREATE_AGENT_SELECTOR = bytes.fromhex(
    # method signature: "create_agent(address,uint64,uint64,uint64,string)void"
    # ABI selector = first 4 bytes of SHA-512/256("create_agent(address,uint64,uint64,uint64,string)void")
    # Computed below at import time so we don't hard-code the wrong hash.
    ""
)


def _abi_selector(method_sig: str) -> bytes:
    from Cryptodome.Hash import SHA512
    h = SHA512.new(truncate="256")
    h.update(method_sig.encode())
    return h.digest()[:4]


SELECTOR = _abi_selector("create_agent(address,uint64,uint64,uint64,string)void")


def _abi_uint64(n: int) -> bytes:
    return n.to_bytes(8, "big")


def _abi_string(s: str) -> bytes:
    body = s.encode()
    return len(body).to_bytes(2, "big") + body


def build_create_agent_appcall(
    admin_addr: str,
    agent_addr: str,
    daily_cap: int,
    monthly_cap: int,
    human_threshold: int,
    routes_csv: str,
    sp: transaction.SuggestedParams,
) -> transaction.ApplicationNoOpTxn:
    agent_pk = algo_encoding.decode_address(agent_addr)  # 32 bytes
    # The routes string on-chain is newline-separated per the contract.
    routes_nl = "\n".join(r.strip() for r in routes_csv.split(",") if r.strip())
    app_args = [
        SELECTOR,
        agent_pk,
        _abi_uint64(daily_cap),
        _abi_uint64(monthly_cap),
        _abi_uint64(human_threshold),
        _abi_string(routes_nl),
    ]
    return transaction.ApplicationNoOpTxn(
        sender=admin_addr,
        sp=sp,
        index=APP_ID,
        app_args=app_args,
        boxes=[(APP_ID, agent_pk)],
    )


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("agent_address")
    p.add_argument("--daily", type=int, default=200_000, help="daily cap μUSDC")
    p.add_argument("--monthly", type=int, default=2_000_000, help="monthly cap μUSDC")
    p.add_argument("--threshold", type=int, default=50_000, help="human threshold μUSDC")
    p.add_argument(
        "--routes",
        default="POST /llm/summarize,POST /gpu/render",
        help="comma-separated route allow-list",
    )
    args = p.parse_args()

    admin = load_wallet(
        os.environ["DEPLOYER_MNEMONIC"],
        account_index=int(os.environ.get("ACCOUNT_INDEX", "0")),
    )
    print(f"admin: {admin.address}")
    print(f"agent: {args.agent_address}")
    print(f"caps : daily={args.daily} monthly={args.monthly} human_threshold={args.threshold}")
    print(f"routes: {args.routes}")

    client = algod.AlgodClient("", os.environ.get("ALGOD_URL", "https://testnet-api.algonode.cloud"))
    sp = client.suggested_params()
    txn = build_create_agent_appcall(
        admin.address, args.agent_address, args.daily, args.monthly, args.threshold, args.routes, sp
    )
    prefixed = constants.txid_prefix + base64.b64decode(algo_encoding.msgpack_encode(txn))
    sig = sign_txn_bytes(admin, prefixed)
    signed = transaction.SignedTransaction(txn, base64.b64encode(sig).decode())
    tx_id = client.send_transaction(signed)
    print(f"submitted {tx_id}")
    result = transaction.wait_for_confirmation(client, tx_id, 10)
    print(f"confirmed round {result['confirmed-round']}")
    print(f"logs: {result.get('logs', [])}")
    print(f"lora: https://lora.algokit.io/testnet/tx/{tx_id}")


if __name__ == "__main__":
    main()
