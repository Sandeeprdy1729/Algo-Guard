"""
Deploy AgentGuard policy contract to Algorand TestNet.

Usage:
    python deploy.py
    # writes app id + address to ./build/deployment.json
    # copy into apps/server/.env as POLICY_APP_ID / POLICY_APP_ADDRESS

Accepts either a 25-word legacy Algorand mnemonic OR a 24-word BIP-39
mnemonic from Pera Universal Wallet. See contracts/wallet.py for the
detection + derivation rules. Set ACCOUNT_INDEX to derive a non-zero
HD account when using BIP-39.
"""
from __future__ import annotations

import base64
import json
import os
import pathlib

from algosdk import transaction
from algosdk.v2client import algod
from dotenv import load_dotenv

from wallet import load_wallet

load_dotenv()

ALGOD_URL = os.environ.get("ALGOD_URL", "https://testnet-api.algonode.cloud")
ALGOD_TOKEN = os.environ.get("ALGOD_TOKEN", "")
DEPLOYER_MNEMONIC = os.environ.get("DEPLOYER_MNEMONIC", "")
ACCOUNT_INDEX = int(os.environ.get("ACCOUNT_INDEX", "0"))


def _load_teal(name: str) -> bytes:
    p = pathlib.Path(__file__).parent / "build" / name
    return p.read_text().encode()


def _compile(client: algod.AlgodClient, source: bytes) -> bytes:
    res = client.compile(source.decode())
    return base64.b64decode(res["result"])


def main() -> None:
    if not DEPLOYER_MNEMONIC:
        raise SystemExit(
            "DEPLOYER_MNEMONIC missing — put a 25-word Algorand mnemonic OR a "
            "24-word BIP-39 (Pera Universal Wallet) phrase in contracts/.env"
        )

    wallet = load_wallet(DEPLOYER_MNEMONIC, account_index=ACCOUNT_INDEX)
    print(
        f"deployer wallet: {wallet.address}  "
        f"({wallet.format}{f' @ {wallet.hd_path}' if wallet.hd_path else ''})"
    )

    client = algod.AlgodClient(ALGOD_TOKEN, ALGOD_URL)
    sp = client.suggested_params()

    approval = _compile(client, _load_teal("approval.teal"))
    clear = _compile(client, _load_teal("clear.teal"))

    txn = transaction.ApplicationCreateTxn(
        sender=wallet.address,
        sp=sp,
        on_complete=transaction.OnComplete.NoOpOC,
        approval_program=approval,
        clear_program=clear,
        global_schema=transaction.StateSchema(num_uints=0, num_byte_slices=1),
        local_schema=transaction.StateSchema(num_uints=0, num_byte_slices=0),
        extra_pages=1,
    )
    signed = txn.sign(wallet.private_key)
    tx_id = client.send_transaction(signed)
    print(f"submitted create tx {tx_id}")
    result = transaction.wait_for_confirmation(client, tx_id, 10)
    app_id = result["application-index"]

    from algosdk.logic import get_application_address

    app_addr = get_application_address(app_id)

    out = {
        "app_id": app_id,
        "app_address": app_addr,
        "deployer": wallet.address,
        "network": "algorand-testnet",
        "lora": f"https://lora.algokit.io/testnet/application/{app_id}",
    }
    build = pathlib.Path(__file__).parent / "build"
    build.mkdir(exist_ok=True)
    (build / "deployment.json").write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))
    print("\ncopy into apps/server/.env:")
    print(f"  POLICY_APP_ID={app_id}")
    print(f"  POLICY_APP_ADDRESS={app_addr}")


if __name__ == "__main__":
    main()
