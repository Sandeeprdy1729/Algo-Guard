"""
Risk scoring via Claude Haiku in JSON mode.

Contract:
  input:  RiskRequest { agent_id, agent_address, route, amount_micro_usdc }
  output: RiskResult  { score: 0..100, reason: str, action: 'allow'|'escalate'|'block' }

We fetch the agent's last ~20 transactions from the server's /api/audit
endpoint and give Claude the raw list as context. The prompt biases the
model to explain *why* — the reason string ships into the audit log.
"""
from __future__ import annotations

import json
import os
from typing import Literal

import httpx
from anthropic import Anthropic
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

_client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
_MODEL = os.environ.get("RISK_MODEL", "claude-haiku-4-5-20251001")
_HISTORY_URL = os.environ.get("HISTORY_URL", "http://localhost:4021/api/audit")


class RiskRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    agent_id: str
    agent_address: str
    route: str
    amount_micro_usdc: int


class RiskResult(BaseModel):
    score: int
    reason: str
    action: Literal["allow", "escalate", "block"]


_SYSTEM = """You score the risk of a single AI-agent API request.

You receive:
  - the request (route + amount in micro-USDC)
  - the agent's last N transactions (route, amount, status, timestamps)

Return STRICT JSON only, no prose, no fences:
  {"score": <int 0-100>, "reason": "<one sentence>", "action": "allow"|"escalate"|"block"}

Scoring guide:
  0-30   normal — matches prior pattern, small amount, sensible cadence
  30-70  unusual — larger than typical, first time on this route, off-hours
  70-89  suspicious — burst frequency, sudden spike, sequence indicative of loop
  90-100 attack pattern — clearly loop / injection / abuse

Actions:
  allow      score < 70 AND no red flag
  escalate   score 70-89 OR sudden spike a human should confirm
  block      score >= 90 OR clear abuse pattern

Reason must reference a concrete signal (e.g. "8 calls in 30s", "amount 50x prior mean").
"""


async def _load_history(agent_id: str) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=1.5) as http:
            r = await http.get(_HISTORY_URL, params={"agent_id": agent_id, "limit": 20})
            r.raise_for_status()
            return r.json().get("transactions", [])
    except Exception:
        return []


def _fallback(req: RiskRequest, history: list[dict]) -> RiskResult:
    """Runs when ANTHROPIC_API_KEY is unset or Anthropic times out."""
    recent = [h for h in history if h.get("status") == "settled"][:10]
    n_recent = len(recent)
    burst = sum(
        1
        for h in recent
        if h.get("route") == req.route
    )
    score = min(100, 10 + burst * 12)
    action: Literal["allow", "escalate", "block"] = (
        "block" if score >= 90 else "escalate" if score >= 70 else "allow"
    )
    reason = (
        f"heuristic fallback — {burst} recent settled calls on {req.route}, "
        f"{n_recent} settled overall in last window"
    )
    return RiskResult(score=score, reason=reason, action=action)


async def score(req: RiskRequest) -> RiskResult:
    history = await _load_history(req.agent_id)

    if not os.environ.get("ANTHROPIC_API_KEY"):
        return _fallback(req, history)

    payload = {
        "request": req.model_dump(by_alias=True),
        "recent_transactions": history,
    }

    try:
        msg = _client.messages.create(
            model=_MODEL,
            max_tokens=200,
            system=_SYSTEM,
            messages=[
                {
                    "role": "user",
                    "content": json.dumps(payload, indent=2),
                }
            ],
        )
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
        text = text.lstrip("`").lstrip("json").lstrip("`").strip()
        if text.endswith("```"):
            text = text[: -3].strip()
        parsed = json.loads(text)
        return RiskResult(**parsed)
    except Exception as exc:
        # Never fail — the middleware treats us as a fail-open advisor.
        return RiskResult(
            score=0,
            reason=f"risk-service exception: {type(exc).__name__}",
            action="allow",
        )
