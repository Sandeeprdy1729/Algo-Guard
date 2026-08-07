"""
Fund the policy contract's app account with min-balance ALGO so it can
allocate box storage per registered agent.

    python contracts/fund_app.py [amount_algo]     # default 1 ALGO
"""
from __future__ import annotations

import base64
import os
import pathlib
import sys

from algosdk import constants, encoding as algo_encoding, transaction
from algosdk.v2client import algod
from dotenv import load_dotenv

from wallet import load_wallet, sign_txn_bytes

load_dotenv()

ALGOD_URL = os.environ.get("ALGOD_URL", "https://testnet-api.algonode.cloud")
DEPLOYER_MNEMONIC = os.environ["DEPLOYER_MNEMONIC"]
ACCOUNT_INDEX = int(os.environ.get("ACCOUNT_INDEX", "0"))

# Read from build/deployment.json produced by deploy.py.
import json

DEPLOYMENT = json.loads((pathlib.Path(__file__).parent / "build" / "deployment.json").read_text())
APP_ADDR = DEPLOYMENT["app_address"]
APP_ID = DEPLOYMENT["app_id"]


def main() -> None:
    amount_algo = float(sys.argv[1]) if len(sys.argv) > 1 else 1.0
    amount_micro = int(amount_algo * 1_000_000)

    wallet = load_wallet(DEPLOYER_MNEMONIC, account_index=ACCOUNT_INDEX)
    client = algod.AlgodClient("", ALGOD_URL)

    print(f"from : {wallet.address}")
    print(f"to   : {APP_ADDR}  (app {APP_ID})")
    print(f"amt  : {amount_algo} ALGO")

    sp = client.suggested_params()
    txn = transaction.PaymentTxn(sender=wallet.address, sp=sp, receiver=APP_ADDR, amt=amount_micro)
    prefixed = constants.txid_prefix + base64.b64decode(algo_encoding.msgpack_encode(txn))
    sig = sign_txn_bytes(wallet, prefixed)
    signed = transaction.SignedTransaction(txn, base64.b64encode(sig).decode())
    tx_id = client.send_transaction(signed)
    print(f"submitted {tx_id}")
    transaction.wait_for_confirmation(client, tx_id, 10)
    info = client.account_info(APP_ADDR)
    print(f"app balance now: {info['amount'] / 1e6} ALGO  (min {info['min-balance'] / 1e6})")
    print(f"lora: https://lora.algokit.io/testnet/tx/{tx_id}")


if __name__ == "__main__":
    main()
