# AgentGuard — Architecture

## Component map

```
┌───────────────────────── CONTROL PLANE ─────────────────────────┐
│  Dashboard (Next.js)   ──► Server API (Hono) ──► Policy Engine │
│         │                     │                        │        │
│      Pera Wallet          Postgres/Prisma        AI Service     │
└────────────────────────────────────────────────────────────────┘
                                │
┌───────────────────────── DATA PLANE ────────────────────────────┐
│  Agent (x402 client) ──► POST /llm/summarize  or  /gpu/render   │
│                                │                                │
│                    [1] policyMiddleware  ── engine + risk       │
│                    [2] paymentMiddleware ── @x402/hono          │
│                    [3] auditMiddleware   ── record + SSE        │
│                    [4] handler                                  │
│                                │                                │
│                       ┌────────┴───────┐                        │
│                       ▼                ▼                        │
│               GoPlausible          Algorand TestNet             │
│               Facilitator     Policy Contract (PyTeal) +        │
│                               USDC ASA transfer (atomic group)  │
└────────────────────────────────────────────────────────────────┘
```

## Request lifecycle

1. Agent → `POST /llm/summarize` with `X-Agent-Address` header.
2. `policyMiddleware` (`apps/server/src/middleware/policy.ts`)
   * looks up the agent + its policy in Postgres
   * queries the AI risk service (`apps/ai-service/main.py`) if the
     request is above `RISK_MIN_AMOUNT_MICRO` ($0.01 by default)
   * evaluates `policy/engine.ts`
   * on **block** → HTTP 403, saves the agent an unnecessary signature
   * on **escalate** → HTTP 402 with `escalationIntentId`, creates a
     pending approval row
   * on **allow** → passes through, stashes context on the Hono ctx
3. `paymentMiddleware` (`@x402/hono`) responds with the standard 402;
   client signs USDC atomic group, retries with `PAYMENT-SIGNATURE`.
4. Facilitator verifies + settles.
5. `auditMiddleware` records the settled txn and broadcasts on SSE.
6. Handler runs and returns the resource.

## On-chain enforcement

The policy contract exposes `record_spend(agent, amount, route_hash)`.
The x402 client is instructed (via the facilitator's atomic-group support)
to include this app call **in the same group** as the USDC transfer. If
the contract's assertions fail (frozen, cap exceeded, unknown route),
the whole group reverts.

## Data model

Postgres is a read-index of on-chain state:

* `users` — dashboard admins
* `agents` — one per algorand address
* `policies` — off-chain mirror of the box
* `transactions` — every request the middleware saw
* `approvals` — pending human decisions
* `audit_logs` — materialized `log()` events from the contract

Chain is truth; every row can be reconstructed from chain history.

## Failure modes

| Component down | Behavior |
|---|---|
| AI risk service | Middleware fails **open** on risk only; on-chain caps still enforced. |
| Groq API for `/llm/summarize` | Handler falls back to a local extractive summary — endpoint stays available. |
| Postgres | Server fails closed; agent gets 500. Contract still enforces on retry. |
| Facilitator | x402 layer surfaces the failure; nothing settles; caps untouched. |
| Policy contract not deployed (`POLICY_APP_ID=0`) | Middleware + dashboard fully functional; indexer no-ops; useful for local dev. |

## Where AI shows up

Exactly one place inline in the request path: risk scoring via
Groq (Llama-3.3-70B by default, JSON mode). One place out-of-band:
natural-language policy authoring on the Policies page. Both share the
same Groq SDK client. No hidden AI, no extra models.

## Middleware order (why it matters)

```
CORS → logging → policyMiddleware → paymentMiddleware → auditMiddleware → handler
```

`policyMiddleware` runs **first** so blocked requests are rejected before
we ever quote a payment. `auditMiddleware` runs **after** so settled
transactions carry their real facilitator settlement receipt.
