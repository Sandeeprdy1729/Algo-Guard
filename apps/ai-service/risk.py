"""
Risk scoring via Groq (OpenAI-compatible chat completions).

Contract (unchanged from the previous Anthropic implementation — the
frontend and Node middleware assume this exact JSON shape):
  input:  RiskRequest { agent_id, agent_address, route, amount_micro_usdc }
  output: RiskResult  { score: 0..100, reason: str, action: 'allow'|'escalate'|'block' }

We ask Groq (default model: llama-3.3-70b-versatile) in JSON mode to
produce the verdict. Recent transactions for the agent are fetched via
the server's /api/audit endpoint and passed as context so the model can
detect burst patterns.

When GROQ_API_KEY is unset OR any error occurs, we fall through to a
deterministic heuristic so the middleware never gets a runtime failure.
"""
from __future__ import annotations

import json
import os
from typing import Literal

import httpx
from groq import Groq
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
_HISTORY_URL = os.environ.get("HISTORY_URL", "http://localhost:4021/api/audit")

# Instantiate lazily — an unset key must not blow up at import time.
_client: Groq | None = None


def _get_client() -> Groq | None:
    global _client
    if _client is not None:
        return _client
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return None
    _client = Groq(api_key=api_key)
    return _client


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

Return STRICT JSON only, matching this exact schema:
  {"score": <int 0-100>, "reason": "<one sentence>", "action": "allow"|"escalate"|"block"}

Scoring guide:
  0-30    normal — matches prior pattern, small amount, sensible cadence
  30-70   unusual — larger than typical, first time on this route, off-hours
  70-89   suspicious — burst frequency, sudden spike, sequence suggesting a loop
  90-100  attack pattern — clearly loop / injection / abuse

Actions:
  allow     score < 70 AND no red flag
  escalate  score 70-89 OR sudden spike a human should confirm
  block     score >= 90 OR clear abuse pattern

`reason` must reference a concrete signal (e.g. "8 calls in 30s",
"amount 50× prior mean")."""


async def _load_history(agent_id: str) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=1.5) as http:
            r = await http.get(_HISTORY_URL, params={"agent_id": agent_id, "limit": 20})
            r.raise_for_status()
            return r.json().get("transactions", [])
    except Exception:
        return []


def _fallback(req: RiskRequest, history: list[dict]) -> RiskResult:
    """Runs when GROQ_API_KEY is unset OR Groq errors out."""
    recent = [h for h in history if h.get("status") == "settled"][:10]
    n_recent = len(recent)
    burst = sum(1 for h in recent if h.get("route") == req.route)
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
    client = _get_client()

    if client is None:
        return _fallback(req, history)

    payload = {
        "request": req.model_dump(by_alias=True),
        "recent_transactions": history,
    }

    try:
        completion = client.chat.completions.create(
            model=_MODEL,
            temperature=0,
            max_tokens=200,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": json.dumps(payload, indent=2)},
            ],
        )
        content = completion.choices[0].message.content or ""
        parsed = json.loads(content.strip())
        return RiskResult(**parsed)
    except Exception as exc:
        # Never fail — middleware treats this as an advisory fail-open.
        return RiskResult(
            score=0,
            reason=f"risk-service exception: {type(exc).__name__}",
            action="allow",
        )
