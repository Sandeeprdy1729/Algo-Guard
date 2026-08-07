"""
Wallet loader — supports two mnemonic formats:

  • Legacy Algorand mnemonic — 25 words, 11-bit-per-word packing, one
    account per phrase. Consumed by algosdk.mnemonic.to_private_key().

  • BIP-39 mnemonic (12 / 15 / 18 / 21 / 24 words) — the new Pera
    Universal Wallet format. Seed is derived with SLIP-0010 ed25519 at
    the Algorand HD path m/44'/283'/{account_index}'/0'/0' (all levels
    hardened — required for ed25519). Cross-verified against the Node
    demo-agent/wallet.ts.

The word count in the phrase decides which flow is taken. `account_index`
lets callers pick a non-zero HD account when the user has multiple.

Returned base64 secret key is the standard Algorand format (64 bytes =
seed || pubkey) — signable via algosdk transaction.sign() directly, so
downstream code (deploy.py) is unchanged.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Literal

from algosdk import account as algo_account
from algosdk import mnemonic as algo_mnemonic

MnemonicFormat = Literal["algorand-25", "bip39"]

LEGACY_WORDS = 25
BIP39_WORDS = {12, 15, 18, 21, 24}


@dataclass(frozen=True)
class Wallet:
    address: str
    private_key: str  # base64-encoded 64-byte secret key (algosdk format)
    format: MnemonicFormat
    hd_path: str | None = None


def detect_format(mnemonic: str) -> MnemonicFormat:
    words = mnemonic.strip().split()
    if len(words) == LEGACY_WORDS:
        return "algorand-25"
    if len(words) in BIP39_WORDS:
        return "bip39"
    raise ValueError(
        f"Unrecognised mnemonic word count: {len(words)}. "
        f"Expected 25 (Algorand legacy) or 12/15/18/21/24 (BIP-39)."
    )


def hd_path(account_index: int = 0) -> str:
    if not isinstance(account_index, int) or account_index < 0:
        raise ValueError(f"account_index must be a non-negative integer, got {account_index}")
    return f"m/44'/283'/{account_index}'/0'/0'"


def load_wallet(mnemonic: str, account_index: int = 0) -> Wallet:
    fmt = detect_format(mnemonic)
    if fmt == "algorand-25":
        return _load_legacy(mnemonic)
    return _load_bip39(mnemonic, account_index)


def _load_legacy(mnemonic: str) -> Wallet:
    private_key = algo_mnemonic.to_private_key(mnemonic)
    address = algo_account.address_from_private_key(private_key)
    return Wallet(address=address, private_key=private_key, format="algorand-25")


def _load_bip39(mnemonic: str, account_index: int) -> Wallet:
    """BIP-39 phrase → SLIP-10 ed25519 derivation at Algorand path.

    Imports of `bip_utils` are lazy so the legacy code path has no new
    runtime dependency — installations that only use 25-word phrases
    don't need bip-utils installed.
    """
    try:
        from bip_utils import (
            Bip39MnemonicValidator,
            Bip39SeedGenerator,
            Bip44,
            Bip44Changes,
            Bip44Coins,
        )
    except ImportError as exc:  # pragma: no cover — documented in .env.example
        raise RuntimeError(
            "A BIP-39 mnemonic was provided but 'bip-utils' is not installed. "
            "Run: pip install bip-utils"
        ) from exc

    if not Bip39MnemonicValidator().IsValid(mnemonic):
        raise ValueError("BIP-39 mnemonic failed checksum validation")

    seed = Bip39SeedGenerator(mnemonic).Generate()  # 64 bytes
    bip44 = Bip44.FromSeed(seed, Bip44Coins.ALGORAND)
    node = (
        bip44.Purpose()
        .Coin()
        .Account(account_index)
        .Change(Bip44Changes.CHAIN_EXT)
        .AddressIndex(0)
    )
    ed25519_seed = node.PrivateKey().Raw().ToBytes()  # 32 bytes
    address = node.PublicKey().ToAddress()

    # Convert ed25519 seed → algosdk-shape 64-byte secret key (seed || pubkey).
    # PyNaCl is transitively installed by bip_utils, so no new dep.
    from nacl.signing import SigningKey

    pubkey = bytes(SigningKey(ed25519_seed).verify_key)
    private_key = base64.b64encode(ed25519_seed + pubkey).decode()

    return Wallet(
        address=address,
        private_key=private_key,
        format="bip39",
        hd_path=hd_path(account_index),
    )
