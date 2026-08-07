"""
Wallet loader — supports two mnemonic formats:

  • Legacy Algorand mnemonic — 25 words. Fully in-process using
    algosdk. Signs 100% in Python.

  • BIP-39 mnemonic (12/15/18/21/24 words) — used by Pera Universal
    Wallet. Follows Algorand's ARC-52 spec: BIP-32-Ed25519 with the
    Peikert amendment, path m/44'/283'/{account_index}'/0/0
    (account hardened, change/index NOT hardened).

    ARC-52 secret keys are 96-byte extended (kL || kR || cc) — not the
    64-byte format algosdk understands. Signing must go through the
    reference impl `@algorandfoundation/xhd-wallet-api`. Rather than
    port the derivation to Python (risky), we shell out to a small Node
    CLI at apps/demo-agent/scripts/xhd-cli.mjs. Node is a required
    dependency for BIP-39 wallets only — legacy 25-word wallets don't
    need Node at all.

Detection is by word count. Callers pick `account_index` for future
multi-account support.
"""
from __future__ import annotations

import base64
import json
import os
import pathlib
import subprocess
import sys
from dataclasses import dataclass
from typing import Literal

from algosdk import account as algo_account
from algosdk import mnemonic as algo_mnemonic

MnemonicFormat = Literal["algorand-25", "bip39-arc52"]

LEGACY_WORDS = 25
BIP39_WORDS = {12, 15, 18, 21, 24}

# Location of the Node CLI relative to the repo root.
_CLI = (
    pathlib.Path(__file__).resolve().parents[1]
    / "apps"
    / "demo-agent"
    / "scripts"
    / "xhd-cli.mjs"
)


@dataclass(frozen=True)
class Wallet:
    address: str
    format: MnemonicFormat
    hd_path: str | None = None
    # Legacy wallets get an in-process 64-byte private key. BIP-39 wallets
    # cannot expose one — their scalar isn't derived from a hashable seed
    # so nothing algosdk can consume exists. Use sign_txn() instead.
    private_key: str | None = None
    # Kept only for BIP-39 so sign_txn() can invoke the Node CLI. Never
    # printed anywhere — treat as sensitive.
    _mnemonic: str | None = None
    _account_index: int = 0


def detect_format(mnemonic: str) -> MnemonicFormat:
    words = mnemonic.strip().split()
    if len(words) == LEGACY_WORDS:
        return "algorand-25"
    if len(words) in BIP39_WORDS:
        return "bip39-arc52"
    raise ValueError(
        f"Unrecognised mnemonic word count: {len(words)}. "
        f"Expected 25 (Algorand legacy) or 12/15/18/21/24 (BIP-39)."
    )


def hd_path(account_index: int = 0) -> str:
    if not isinstance(account_index, int) or account_index < 0:
        raise ValueError(f"account_index must be a non-negative integer, got {account_index}")
    return f"m/44'/283'/{account_index}'/0/0"


def load_wallet(mnemonic: str, account_index: int = 0) -> Wallet:
    fmt = detect_format(mnemonic)
    if fmt == "algorand-25":
        return _load_legacy(mnemonic)
    return _load_bip39(mnemonic, account_index)


def _load_legacy(mnemonic: str) -> Wallet:
    private_key = algo_mnemonic.to_private_key(mnemonic)
    address = algo_account.address_from_private_key(private_key)
    return Wallet(
        address=address,
        format="algorand-25",
        hd_path=None,
        private_key=private_key,
    )


def _run_cli(subcommand: str, mnemonic: str, account_index: int, stdin: str | None = None) -> dict:
    if not _CLI.exists():
        raise RuntimeError(
            f"ARC-52 CLI not found at {_CLI}. Install demo-agent deps:\n"
            f"  cd apps/demo-agent && npm install"
        )
    proc = subprocess.run(
        ["node", str(_CLI), subcommand],
        input=stdin,
        env={
            **os.environ,
            "MNEMONIC": mnemonic,
            "ACCOUNT_INDEX": str(account_index),
        },
        capture_output=True,
        text=True,
        timeout=30,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"xhd-cli {subcommand} failed (exit {proc.returncode}):\n"
            f"stderr: {proc.stderr.strip()}"
        )
    try:
        return json.loads(proc.stdout.strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError) as exc:
        raise RuntimeError(f"xhd-cli produced invalid JSON: {proc.stdout!r}") from exc


def _load_bip39(mnemonic: str, account_index: int) -> Wallet:
    result = _run_cli("derive", mnemonic, account_index)
    return Wallet(
        address=result["address"],
        format="bip39-arc52",
        hd_path=result["hdPath"],
        private_key=None,
        _mnemonic=mnemonic,
        _account_index=account_index,
    )


def sign_txn_bytes(wallet: Wallet, prefixed_txn_bytes: bytes) -> bytes:
    """
    Return the 64-byte ed25519 signature for `prefixed_txn_bytes`, which
    is what `algosdk.transaction.Transaction.raw_sign()` produces — the
    msgpack encoding of the txn with a leading "TX" domain-separation
    tag.

    Legacy wallets: signs in-process with algosdk.
    BIP-39 wallets: shells out to the ARC-52 CLI.
    """
    if wallet.format == "algorand-25":
        # We stored the base64 sk on the wallet.
        sk_bytes = base64.b64decode(wallet.private_key or "")
        # PyNaCl mirrors what algosdk does internally.
        from nacl.signing import SigningKey

        seed = sk_bytes[:32]
        return bytes(SigningKey(seed).sign(prefixed_txn_bytes).signature)

    if wallet.format == "bip39-arc52":
        if not wallet._mnemonic:
            raise RuntimeError("bip39 wallet missing mnemonic — reload with load_wallet()")
        stdin = json.dumps({"txnBase64": base64.b64encode(prefixed_txn_bytes).decode()})
        result = _run_cli("sign", wallet._mnemonic, wallet._account_index, stdin=stdin)
        return base64.b64decode(result["sigBase64"])

    raise RuntimeError(f"unsupported wallet format {wallet.format!r}")
