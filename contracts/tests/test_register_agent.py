"""
Unit tests for contracts/register_agent.py — purely offline.

We verify:
  1. The ABI method selectors match what the contract emits.
  2. `build_create_agent_appcall` produces a well-formed ApplicationNoOpTxn
     with the right app id, method selector, arg encoding, and box ref.
  3. `build_update_policy_appcall` does the same for the update method.
  4. `_load_policy_app_id` reads the env override first and falls back to
     deployment.json when the env var is missing.
  5. `is_agent_registered` correctly interprets a 404 from algod as
     "not registered" and any other error as an actual failure.

No live TestNet transaction is submitted here — that path is exercised
manually via the CLI (see README + the DEPLOYER's own run).
"""
from __future__ import annotations

import base64
import json
import pathlib
import sys
from unittest.mock import MagicMock

import pytest
from algosdk import account as algo_account
from algosdk import encoding as algo_encoding

# Make contracts/ importable
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import register_agent as ra  # noqa: E402


# ── ABI selectors ────────────────────────────────────────────────────
def test_create_agent_selector_matches_contract_json():
    """Selector we emit must match what the ARC-4 contract JSON expects."""
    contract = json.loads(
        (pathlib.Path(__file__).resolve().parents[1] / "build" / "contract.json").read_text()
    )
    m = next(m for m in contract["methods"] if m["name"] == "create_agent")
    sig = m["name"] + "(" + ",".join(a["type"] for a in m["args"]) + ")" + m["returns"]["type"]
    assert sig == ra.CREATE_AGENT_SIG
    assert ra._abi_selector(sig) == ra.CREATE_AGENT_SELECTOR
    assert len(ra.CREATE_AGENT_SELECTOR) == 4


def test_update_policy_selector_matches_contract_json():
    contract = json.loads(
        (pathlib.Path(__file__).resolve().parents[1] / "build" / "contract.json").read_text()
    )
    m = next(m for m in contract["methods"] if m["name"] == "update_policy")
    sig = m["name"] + "(" + ",".join(a["type"] for a in m["args"]) + ")" + m["returns"]["type"]
    assert sig == ra.UPDATE_POLICY_SIG
    assert ra._abi_selector(sig) == ra.UPDATE_POLICY_SELECTOR


# ── Primitive encoders ──────────────────────────────────────────────
def test_abi_uint64_big_endian():
    assert ra._abi_uint64(0) == b"\x00" * 8
    assert ra._abi_uint64(1) == b"\x00" * 7 + b"\x01"
    assert ra._abi_uint64(200_000) == (200_000).to_bytes(8, "big")


def test_abi_string_prefixes_length():
    encoded = ra._abi_string("hello")
    assert encoded[:2] == b"\x00\x05"
    assert encoded[2:] == b"hello"


# ── Txn builders ────────────────────────────────────────────────────
@pytest.fixture
def dummy_sp():
    # Deterministic suggested params — no network needed.
    from algosdk import transaction

    return transaction.SuggestedParams(
        fee=1000,
        first=1,
        last=1000,
        gh=bytes(32),
        gen="testnet-v1.0",
        flat_fee=True,
    )


@pytest.fixture
def fresh_addresses():
    _, admin = algo_account.generate_account()
    _, agent = algo_account.generate_account()
    return admin, agent


def test_build_create_agent_appcall_shape(dummy_sp, fresh_addresses):
    admin, agent = fresh_addresses
    txn = ra.build_create_agent_appcall(
        admin_addr=admin,
        agent_addr=agent,
        daily_cap=100_000,
        monthly_cap=1_000_000,
        human_threshold=50_000,
        routes_csv="POST /llm/summarize, POST /gpu/render",
        app_id=768730271,
        sp=dummy_sp,
    )

    assert txn.sender == admin
    assert txn.index == 768730271
    # 6 app args: selector + 5 method args
    assert len(txn.app_args) == 6
    assert txn.app_args[0] == ra.CREATE_AGENT_SELECTOR
    assert txn.app_args[1] == algo_encoding.decode_address(agent)
    assert txn.app_args[2] == (100_000).to_bytes(8, "big")
    assert txn.app_args[3] == (1_000_000).to_bytes(8, "big")
    assert txn.app_args[4] == (50_000).to_bytes(8, "big")
    # ABI string body: 2-byte length + newline-joined routes.
    routes_body = txn.app_args[5]
    assert routes_body[2:].decode() == "POST /llm/summarize\nPOST /gpu/render"
    # Box reference exists and points at the agent's pubkey. py-algorand-sdk
    # wraps our (id, name) tuple in a BoxReference; compare via attributes.
    assert len(txn.boxes) == 1
    assert bytes(txn.boxes[0].name) == algo_encoding.decode_address(agent)


def test_build_update_policy_appcall_shape(dummy_sp, fresh_addresses):
    admin, agent = fresh_addresses
    txn = ra.build_update_policy_appcall(
        admin_addr=admin,
        agent_addr=agent,
        daily_cap=500_000,
        monthly_cap=10_000_000,
        human_threshold=100_000,
        app_id=768730271,
        sp=dummy_sp,
    )
    assert txn.sender == admin
    assert txn.index == 768730271
    # 5 app args: selector + 4 method args (no routes)
    assert len(txn.app_args) == 5
    assert txn.app_args[0] == ra.UPDATE_POLICY_SELECTOR
    assert txn.app_args[1] == algo_encoding.decode_address(agent)
    assert txn.app_args[2] == (500_000).to_bytes(8, "big")
    assert txn.app_args[3] == (10_000_000).to_bytes(8, "big")
    assert txn.app_args[4] == (100_000).to_bytes(8, "big")
    assert len(txn.boxes) == 1
    assert bytes(txn.boxes[0].name) == algo_encoding.decode_address(agent)


# ── Env / deployment loader ─────────────────────────────────────────
def test_load_policy_app_id_prefers_env(monkeypatch):
    monkeypatch.setenv("POLICY_APP_ID", "42")
    assert ra._load_policy_app_id() == 42


def test_load_policy_app_id_falls_back_to_deployment_json(monkeypatch):
    monkeypatch.delenv("POLICY_APP_ID", raising=False)
    # This project has a real deployment.json; the fallback must succeed.
    assert ra._load_policy_app_id() == 768730271


def test_load_policy_app_id_rejects_garbage_env(monkeypatch):
    monkeypatch.setenv("POLICY_APP_ID", "not-a-number")
    with pytest.raises(SystemExit, match="not an integer"):
        ra._load_policy_app_id()


# ── Idempotency check ───────────────────────────────────────────────
def test_is_agent_registered_true_when_box_returns():
    client = MagicMock()
    client.application_box_by_name.return_value = {"name": b"x", "value": b"header"}
    _, agent = algo_account.generate_account()
    assert ra.is_agent_registered(client, 42, agent) is True


def test_is_agent_registered_false_on_404():
    client = MagicMock()
    client.application_box_by_name.side_effect = Exception("box not found")
    _, agent = algo_account.generate_account()
    assert ra.is_agent_registered(client, 42, agent) is False


def test_is_agent_registered_reraises_real_errors():
    client = MagicMock()
    client.application_box_by_name.side_effect = Exception("connection refused")
    _, agent = algo_account.generate_account()
    with pytest.raises(Exception, match="connection refused"):
        ra.is_agent_registered(client, 42, agent)


# ── CLI parser ──────────────────────────────────────────────────────
def test_parse_args_defaults_agent_to_none():
    ns = ra._parse_args([])
    assert ns.agent is None
    assert ns.daily == 200_000
    assert ns.monthly == 2_000_000
    assert ns.threshold == 50_000
    assert ns.routes == "POST /llm/summarize,POST /gpu/render"
    assert ns.force_update is False
    assert ns.check_only is False


def test_parse_args_accepts_overrides():
    ns = ra._parse_args(
        [
            "--agent",
            "A" * 58,
            "--daily",
            "123",
            "--force-update",
            "--check-only",
        ]
    )
    assert ns.agent == "A" * 58
    assert ns.daily == 123
    assert ns.force_update is True
    assert ns.check_only is True
