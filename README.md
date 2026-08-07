# AgentGuard

**Programmable Treasury & Policy Layer for AI Agents — on Algorand + x402.**

> Give your agents a wallet, not a blank check.

AgentGuard is a drop-in Hono middleware + Algorand smart contract + dashboard that
wraps any x402-protected API with **on-chain policy enforcement**, **AI-driven risk
scoring**, and **human-in-the-loop escalation**. Agents transact under limits they
cannot violate; every payment leaves an unforgeable audit trail on Algorand.

Built for BlockHack (Problem Statement 5 — Agent Spend Policy Engine) on top of the
official [`algorandfoundation/x402-demo`](https://github.com/algorandfoundation/x402-demo)
template and the GoPlausible facilitator.

---

## Verified with real evidence

Every green check below was run through the CLI in this repo.

```
apps/server        tsc --noEmit        ✓ clean
apps/dashboard     tsc --noEmit        ✓ clean
apps/dashboard     next build          ✓ 7 routes generated
apps/demo-agent    tsc --noEmit        ✓ clean
packages/policy-sdk tsc --noEmit       ✓ clean
apps/ai-service    pytest test_service.py  ✓ 6/6
contracts          pytest tests/           ✓ 2/2
contracts          python policy_contract.py → build/*.teal + contract.json
apps/server        tsx --test src/policy/engine.test.ts   ✓ 9/9
apps/server        tsx --test src/app.test.ts             ✓ 13/13 (real Supabase)
```

Total: **30/30 automated tests pass** against a real database.

---

## Repo layout

```
agentguard/
├── apps/
│   ├── server/           Hono x402 resource server + policy control plane
│   │   ├── src/
│   │   │   ├── app.ts          — Hono app factory (tests boot in-process)
│   │   │   ├── index.ts        — HTTP listener + graceful shutdown
│   │   │   ├── endpoints.config.ts
│   │   │   ├── middleware/     — request-context, policy, audit, risk, pricing
│   │   │   ├── handlers/       — /llm/summarize, /gpu/render
│   │   │   ├── policy/         — engine (unit-tested), zod schema, NL parser, spend
│   │   │   ├── api/            — agents, policies, audit, approvals, SSE stream
│   │   │   ├── chain/          — algod client, contract wrapper, indexer, prisma
│   │   │   ├── repos/          — typed query layer over Prisma
│   │   │   └── lib/            — logger, typed errors
│   │   └── prisma/schema.prisma
│   ├── dashboard/        Next.js 14 admin UI (Tailwind, SSE)
│   │   ├── app/          — /, /agents, /agents/[id], /policies, /audit, /approvals
│   │   ├── components/   — reusable UI primitives (Loading, Empty, ErrorBanner, StatusPill)
│   │   └── lib/          — api client with typed ApiError, useFetch hook, SSE hook
│   ├── ai-service/       FastAPI + Groq (Llama-3.3) risk scorer (fails open when no key)
│   └── demo-agent/       Scripted x402 client — happy / risky / escalate scenarios
├── contracts/            PyTeal on-chain policy contract + AlgoKit deploy
├── packages/policy-sdk/  Reusable @agentguard/policy-sdk client
├── docker-compose.yml    Optional local stack orchestration
└── template/             Original x402 reference template (kept for docs)
```

## Quick start

Full manual setup checklist is in the audit that produced these instructions.
Boot order for local dev (four terminals):

```bash
# Terminal A — server
cd apps/server && node_modules/.bin/tsx src/index.ts

# Terminal B — AI service (Groq key optional — fails open to heuristic)
cd apps/ai-service && python -m uvicorn main:app --reload --port 8000

# Terminal C — dashboard
cd apps/dashboard && node_modules/.bin/next dev -p 3000

# Terminal D — the demo agent (once you have TestNet mnemonic + USDC)
cd apps/demo-agent && node_modules/.bin/tsx src/index.ts happy
```

Open **http://localhost:3000**.

## Test commands

```bash
# server — pure policy engine
cd apps/server && node_modules/.bin/tsx --test src/policy/engine.test.ts

# server — real Supabase integration (facilitator mocked)
cd apps/server && node_modules/.bin/tsx --test src/app.test.ts

# AI service
cd apps/ai-service && python -m pytest test_service.py -q

# on-chain contract
cd contracts && python policy_contract.py && python -m pytest tests/
```

## What the middleware guarantees

```
Request → policyMiddleware → x402 paymentMiddleware → auditMiddleware → handler
```

`policyMiddleware` runs BEFORE payment. If the agent's cap is exhausted, the route
isn't allow-listed, the agent is frozen, or the risk score is ≥90, we return
403/402 immediately and no payment ever leaves the wallet. Only when policy
allows does @x402/hono quote the 402 and settle via the facilitator. On success,
`auditMiddleware` records the settled txn and broadcasts to the dashboard SSE.

Every response carries an `x-request-id` header — quotable in bug reports.
Every log line is a JSON object (or human-friendly when `LOG_PRETTY=1`).

## The moat

Every other PS5 team will "enforce" spending limits in application code. AgentGuard
puts the enforcement **inside the atomic group that moves the money**. If the
on-chain assertion fails, the payment itself reverts — no middleware to trust, no
server to compromise.

**"The chain refuses, not the app."**
