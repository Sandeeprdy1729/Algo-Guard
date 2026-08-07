"""
End-to-end tests for the risk service using FastAPI's TestClient.

No Anthropic key required — asserts the deterministic fallback path.
Run with: python -m pytest test_service.py -q
"""
import warnings
warnings.filterwarnings("ignore")

from fastapi.testclient import TestClient

from main import app
from risk import RiskRequest, _fallback


client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["model"].startswith("claude")


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
