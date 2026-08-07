"""
Smoke tests that ensure the contract compiles and the artifact JSON has
the expected ABI methods. Full on-chain integration tests are out of
scope for the hackathon MVP — the middleware + engine cover behavioral
tests, and the contract's assertions are minimal enough to eyeball.
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _build():
    subprocess.check_call([sys.executable, str(ROOT / "policy_contract.py")], cwd=ROOT)


def test_compiles_and_exports_methods():
    _build()
    contract = json.loads((ROOT / "build" / "contract.json").read_text())
    method_names = {m["name"] for m in contract["methods"]}
    assert {
        "create_agent",
        "update_policy",
        "record_spend",
        "approve_intent",
        "freeze_agent",
    }.issubset(method_names), method_names


def test_teal_artifacts_exist():
    for f in ("approval.teal", "clear.teal", "contract.json"):
        assert (ROOT / "build" / f).exists(), f
