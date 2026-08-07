"""
End-to-end tests for the risk service using FastAPI's TestClient.

No Groq key required — asserts the deterministic fallback path so tests
are hermetic. When GROQ_API_KEY IS present the live path is exercised in
the "live" tests at the bottom.

Run with: python -m pytest test_service.py -q
"""
import os
import warnings

warnings.filterwarnings("ignore")

import pytest
from fastapi.testclient import TestClient

# Force the fallback path regardless of ambient env, so hermetic tests
# never contact the network. Live tests re-enable it explicitly.
os.environ.pop("GROQ_API_KEY", None)

import risk  # noqa: E402

risk._client = None

# main.py calls load_dotenv() at import which may re-inject GROQ_API_KEY
# from ../server/.env if the CWD chain hits it. Pop again to be sure.
from main import app  # noqa: E402

os.environ.pop("GROQ_API_KEY", None)
risk._client = None

from risk import RiskRequest, _fallback  # noqa: E402


client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["provider"] == "groq"
    assert body["model"].startswith("llama")
    assert body["groq_configured"] is False  # forced off above


def test_score_camel_case():
    r = client.post(
        "/score",
        json={
            "agentId": "agent-1",
            "agentAddress": "A" * 58,
            "route": "POST /llm/summarize",
            "amountMicroUsdc": 10_000,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"score", "reason", "action"}
    assert 0 <= body["score"] <= 100
    assert body["action"] in ("allow", "escalate", "block")


def test_score_snake_case():
    r = client.post(
        "/score",
        json={
            "agent_id": "agent-1",
            "agent_address": "A" * 58,
            "route": "POST /llm/summarize",
            "amount_micro_usdc": 10_000,
        },
    )
    assert r.status_code == 200


def test_score_missing_fields():
    r = client.post("/score", json={"route": "POST /x"})
    assert r.status_code == 422
    missing = [d["loc"][-1] for d in r.json()["detail"]]
    assert "agentId" in missing
    assert "agentAddress" in missing
    assert "amountMicroUsdc" in missing


def test_fallback_burst_pattern_escalates():
    req = RiskRequest(
        agent_id="agent-1",
        agent_address="A" * 58,
        route="POST /llm/summarize",
        amount_micro_usdc=10_000,
    )
    # 10 identical settled calls should look like a burst.
    history = [
        {"status": "settled", "route": "POST /llm/summarize"} for _ in range(10)
    ]
    result = _fallback(req, history)
    assert result.score >= 70
    assert result.action in ("escalate", "block")


def test_fallback_first_time_allows():
    req = RiskRequest(
        agent_id="agent-1",
        agent_address="A" * 58,
        route="POST /llm/summarize",
        amount_micro_usdc=10_000,
    )
    result = _fallback(req, [])
    assert result.action == "allow"
    assert result.score < 70


# ── Live Groq path (skipped unless GROQ_API_KEY_TEST is provided) ─────
#
# Set GROQ_API_KEY_TEST to opt into hitting the real Groq API. Kept
# behind a separate name so the hermetic tests above always short-circuit
# the client at import time.

_LIVE_KEY = os.environ.get("GROQ_API_KEY_TEST")
requires_groq = pytest.mark.skipif(
    not _LIVE_KEY, reason="GROQ_API_KEY_TEST not set"
)


@requires_groq
def test_score_via_live_groq_returns_valid_json():
    os.environ["GROQ_API_KEY"] = _LIVE_KEY  # type: ignore[arg-type]
    # Reset the cached client so it picks up the key.
    import risk as _risk
    _risk._client = None
    live_client = TestClient(app)
    r = live_client.post(
        "/score",
        json={
            "agentId": "agent-live",
            "agentAddress": "A" * 58,
            "route": "POST /llm/summarize",
            "amountMicroUsdc": 10_000,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"score", "reason", "action"}
    assert 0 <= body["score"] <= 100
    assert body["action"] in ("allow", "escalate", "block")
    # Reason should not be the heuristic fallback string.
    assert "heuristic fallback" not in body["reason"]
