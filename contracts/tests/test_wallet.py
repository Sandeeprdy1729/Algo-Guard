"""
Wallet loader tests.

The BIP-39 reference address is the SAME value asserted by the Node
suite in apps/demo-agent/src/wallet.test.ts — if either drifts, both
tests fail loudly, catching cross-language regressions.

Run:  python -m pytest contracts/tests/test_wallet.py -q
"""
from __future__ import annotations

import base64
import pathlib
import sys

import pytest

# Import contracts/wallet.py without needing a package install.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from wallet import detect_format, hd_path, load_wallet  # noqa: E402

from algosdk import account as algo_account  # noqa: E402
from algosdk import mnemonic as algo_mnemonic  # noqa: E402
from algosdk import transaction as algo_txn  # noqa: E402


BIP39_24 = (
    "abandon abandon abandon abandon abandon abandon abandon abandon "
    "abandon abandon abandon abandon abandon abandon abandon abandon "
    "abandon abandon abandon abandon abandon abandon abandon art"
)
# Cross-verified against the Node loader.
BIP39_24_ADDR_IDX0 = "3DCHXKKTAQWB2PRAPY3IIMQ23F4J4Y2M57UCRV4ZBXRATQNAIYR7CPOPG4"

# Stable across the entire test module — generated once, so all "legacy"
# assertions compare against the same address.
_LEGACY_SK, _LEGACY_ADDR = algo_account.generate_account()
_LEGACY_MNEMONIC = algo_mnemonic.from_private_key(_LEGACY_SK)


# ── detect_format ────────────────────────────────────────────────
def _legacy_mnemonic() -> str:
    """A valid 25-word mnemonic (fixed for the module)."""
    return _LEGACY_MNEMONIC


def test_detect_25_words():
    assert detect_format(_legacy_mnemonic()) == "algorand-25"


def test_detect_24_words():
    assert detect_format(BIP39_24) == "bip39"


def test_detect_12_words():
    twelve = "abandon " * 11 + "about"
    assert detect_format(twelve.strip()) == "bip39"


def test_detect_collapses_whitespace():
    mn = _legacy_mnemonic().replace(" ", "   ")
    assert detect_format(f"   {mn}   ") == "algorand-25"


def test_detect_other_counts_throw():
    with pytest.raises(ValueError, match="Unrecognised mnemonic word count"):
        detect_format("one two three four")


# ── hd_path ──────────────────────────────────────────────────────
def test_hd_path_defaults():
    assert hd_path(0) == "m/44'/283'/0'/0'/0'"
    assert hd_path(5) == "m/44'/283'/5'/0'/0'"


def test_hd_path_rejects_bad_indices():
    with pytest.raises(ValueError):
        hd_path(-1)
    with pytest.raises(ValueError):
        hd_path(1.5)  # type: ignore[arg-type]


# ── legacy round trip ────────────────────────────────────────────
def test_legacy_round_trip():
    mn = _legacy_mnemonic()
    w = load_wallet(mn)
    assert w.format == "algorand-25"
    assert w.hd_path is None
    # Match against algosdk directly.
    sk = algo_mnemonic.to_private_key(mn)
    addr = algo_account.address_from_private_key(sk)
    assert w.address == addr
    assert w.private_key == sk


def test_legacy_load_twice_is_stable():
    mn = _legacy_mnemonic()
    assert load_wallet(mn) == load_wallet(mn)


# ── BIP-39 24-word ───────────────────────────────────────────────
def test_bip39_reference_address():
    w = load_wallet(BIP39_24)
    assert w.format == "bip39"
    assert w.hd_path == "m/44'/283'/0'/0'/0'"
    assert w.address == BIP39_24_ADDR_IDX0
    # sk is base64 of the 64-byte algosdk secret key.
    raw = base64.b64decode(w.private_key)
    assert len(raw) == 64


def test_bip39_account_index_changes_address():
    a = load_wallet(BIP39_24, account_index=0)
    b = load_wallet(BIP39_24, account_index=1)
    assert a.address != b.address
    assert b.hd_path == "m/44'/283'/1'/0'/0'"


def test_bip39_wallet_can_sign_a_transaction():
    """Signs a real payment txn — throws if seed/pubkey are inconsistent."""
    w = load_wallet(BIP39_24)
    sp = algo_txn.SuggestedParams(
        fee=1000, first=1, last=1000, gh=bytes(32), gen="testnet-v1.0", flat_fee=True
    )
    txn = algo_txn.PaymentTxn(sender=w.address, sp=sp, receiver=w.address, amt=0)
    signed = txn.sign(w.private_key)
    # sign() throws if the base64-decoded key isn't a valid 64-byte ed25519 sk
    # OR if the derived pubkey doesn't match the sender. The stored signature
    # is a base64 string of 64 bytes → 88 chars including padding.
    assert signed.signature is not None
    assert len(base64.b64decode(signed.signature)) == 64


def test_bip39_bad_checksum_rejected():
    bad = BIP39_24.replace("art", "zoo")  # valid wordlist entry, wrong checksum
    with pytest.raises(ValueError, match="checksum"):
        load_wallet(bad)


# ── Cross-format sanity ──────────────────────────────────────────
def test_cross_format_addresses_differ():
    legacy = load_wallet(_legacy_mnemonic())
    bip = load_wallet(BIP39_24)
    assert legacy.address != bip.address
    assert legacy.format == "algorand-25"
    assert bip.format == "bip39"
