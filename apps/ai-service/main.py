"""
AgentGuard AI service — FastAPI.

Single job: score risk on every non-trivial x402 request via Groq.
Kept tiny on purpose (one endpoint, one LLM call, cached upstream).
"""
from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI

from risk import RiskRequest, RiskResult, score

load_dotenv()

app = FastAPI(
    title="AgentGuard AI Service",
    version="0.2.0",
    description="Groq (Llama-3.3) risk-scoring for x402 requests.",
)


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "provider": "groq",
        "model": os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile"),
        "groq_configured": bool(os.environ.get("GROQ_API_KEY")),
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
