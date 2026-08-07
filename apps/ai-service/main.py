"""
AgentGuard AI service — FastAPI.

Single job: score risk on every non-trivial x402 request.
Kept tiny on purpose (one endpoint, one LLM call, cached upstream).
"""
from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from pydantic import BaseModel

from risk import RiskRequest, RiskResult, score

load_dotenv()

app = FastAPI(
    title="AgentGuard AI Service",
    version="0.1.0",
    description="Claude Haiku risk-scoring for x402 requests.",
)


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "model": os.environ.get("RISK_MODEL", "claude-haiku-4-5-20251001"),
        "anthropic_configured": bool(os.environ.get("ANTHROPIC_API_KEY")),
    }


@app.post("/score", response_model=RiskResult)
async def score_endpoint(req: RiskRequest) -> RiskResult:
    return await score(req)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8000")),
        reload=True,
    )
