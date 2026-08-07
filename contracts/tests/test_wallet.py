"""
Wallet loader tests.

Legacy tests still assert full in-process signing.

BIP-39 tests assert:
  1. The ARC-52 CLI is invoked and returns the SAME address the Pera
     Universal Wallet displays for a known reference phrase.
  2. sign_txn_bytes() round-trips: the 64-byte signature it emits
     verifies against the public key derived from the SAME phrase.

Skipped automatically if Node isn't on PATH.

Run:  python -m pytest contracts/tests/test_wallet.py -q
"""
from __future__ import annotations

import base64
import pathlib
import shutil
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from wallet import detect_format, hd_path, load_wallet, sign_txn_bytes  # noqa: E402

from algosdk import account as algo_account  # noqa: E402
from algosdk import constants as algo_constants  # noqa: E402
from algosdk import encoding as algo_encoding  # noqa: E402
from algosdk import mnemonic as algo_mnemonic  # noqa: E402
from algosdk import transaction as algo_txn  # noqa: E402


# 24-word BIP-39 reference. The Pera Universal Wallet address for this
# exact phrase at ARC-52 (Peikert, Address ctx, account=0, keyIndex=0) is
# hard-coded here — cross-verified against @algorandfoundation/xhd-wallet-api.
BIP39_24 = (
    "abandon abandon abandon abandon abandon abandon abandon abandon "
    "abandon abandon abandon abandon abandon abandon abandon abandon "
    "abandon abandon abandon abandon abandon abandon abandon art"
)
BIP39_24_PERA_ADDR_IDX0 = "IYRGHE7NYTZRYPGFFNVPH7TVCZVQLQFK2IJ57W5JONTHT4BZEYHXL3MY3E"

_LEGACY_SK, _LEGACY_ADDR = algo_account.generate_account()
_LEGACY_MNEMONIC = algo_mnemonic.from_private_key(_LEGACY_SK)

NODE_AVAILABLE = shutil.which("node") is not None
requires_node = pytest.mark.skipif(
    not NODE_AVAILABLE, reason="Node.js is required for BIP-39 (ARC-52) wallets"
)


def _legacy_mnemonic() -> str:
    return _LEGACY_MNEMONIC


# ── detect_format ────────────────────────────────────────────────
def test_detect_25_words():
    assert detect_format(_legacy_mnemonic()) == "algorand-25"


def test_detect_24_words():
    assert detect_format(BIP39_24) == "bip39-arc52"


def test_detect_12_words():
    assert detect_format("abandon " * 11 + "about") == "bip39-arc52"


def test_detect_collapses_whitespace():
    mn = _legacy_mnemonic().replace(" ", "   ")
    assert detect_format(f"   {mn}   ") == "algorand-25"


def test_detect_other_counts_throw():
    with pytest.raises(ValueError, match="Unrecognised mnemonic word count"):
        detect_format("one two three four")


# ── hd_path ──────────────────────────────────────────────────────
def test_hd_path_defaults():
    # Peikert path — last two levels NON-hardened per ARC-52 Address context.
    assert hd_path(0) == "m/44'/283'/0'/0/0"
    assert hd_path(5) == "m/44'/283'/5'/0/0"


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
    sk = algo_mnemonic.to_private_key(mn)
    addr = algo_account.address_from_private_key(sk)
    assert w.address == addr
    assert w.private_key == sk


def test_legacy_load_twice_is_stable():
    mn = _legacy_mnemonic()
    a = load_wallet(mn)
    b = load_wallet(mn)
    assert a.address == b.address
    assert a.private_key == b.private_key


def test_legacy_sign_txn_bytes_produces_valid_signature():
    w = load_wallet(_legacy_mnemonic())
    payload = b"TX" + b"deadbeef"
    sig = sign_txn_bytes(w, payload)
    assert len(sig) == 64

    # Verify against the pubkey extracted from the address.
    from nacl.signing import VerifyKey

    pubkey = algo_encoding.decode_address(w.address)
    VerifyKey(pubkey).verify(payload, sig)  # raises on invalid


# ── BIP-39 24-word (ARC-52 via Node CLI) ─────────────────────────
@requires_node
def test_bip39_derives_pera_reference_address():
    w = load_wallet(BIP39_24)
    assert w.format == "bip39-arc52"
    assert w.hd_path == "m/44'/283'/0'/0/0"
    assert w.address == BIP39_24_PERA_ADDR_IDX0
    # ARC-52 wallets deliberately have no algosdk-shape private key.
    assert w.private_key is None


@requires_node
def test_bip39_account_index_changes_address():
    a = load_wallet(BIP39_24, account_index=0)
    b = load_wallet(BIP39_24, account_index=1)
    assert a.address != b.address
    assert b.hd_path == "m/44'/283'/1'/0/0"


@requires_node
def test_bip39_sign_txn_bytes_verifies_against_derived_pubkey():
    w = load_wallet(BIP39_24)
    payload = b"TX" + b"the quick brown fox"
    sig = sign_txn_bytes(w, payload)
    assert len(sig) == 64

    from nacl.signing import VerifyKey

    pubkey = algo_encoding.decode_address(w.address)
    VerifyKey(pubkey).verify(payload, sig)


@requires_node
def test_bip39_wallet_can_sign_a_real_algorand_txn():
    """End-to-end: build a real PaymentTxn, sign it, verify the sig."""
    w = load_wallet(BIP39_24)
    sp = algo_txn.SuggestedParams(
        fee=1000, first=1, last=1000, gh=bytes(32), gen="testnet-v1.0", flat_fee=True
    )
    txn = algo_txn.PaymentTxn(sender=w.address, sp=sp, receiver=w.address, amt=0)
    txn_b64 = algo_encoding.msgpack_encode(txn)
    prefixed = algo_constants.txid_prefix + base64.b64decode(txn_b64)
    sig = sign_txn_bytes(w, prefixed)

    from nacl.signing import VerifyKey

    pubkey = algo_encoding.decode_address(w.address)
    VerifyKey(pubkey).verify(prefixed, sig)


# ── Cross-format sanity ──────────────────────────────────────────
@requires_node
def test_cross_format_addresses_differ():
    legacy = load_wallet(_legacy_mnemonic())
    bip = load_wallet(BIP39_24)
    assert legacy.address != bip.address
    assert legacy.format == "algorand-25"
    assert bip.format == "bip39-arc52"
