# AgentGuard — 3-minute demo script

Stage layout (single screen, three panels):

```
┌── terminal (agent) ────┬── dashboard (localhost:3000) ──┬── lora.algokit.io ──┐
│  pnpm demo happy       │  Overview / Agents / Approvals │  contract + tx pane │
└────────────────────────┴────────────────────────────────┴─────────────────────┘
```

## Beat 1 — Policy on chain, authored in English (0:00 – 1:00)

**Say:**
> "This is an autonomous agent with $10 of USDC on Algorand. Zero
> limits. Watch."

Run:
```
pnpm --filter @agentguard/demo-agent start risky
```
- Dashboard spend chart climbs. Agent burns real TestNet USDC.

**Say:**
> "Now I turn on AgentGuard with one sentence."

In dashboard → **Policies**, type:
> Cap this agent at $0.10/day, human approval above $0.05

Click **Generate policy** → JSON diff shown → **Sign & commit to chain**.

- Pera Wallet popup on projector → sign → chain confirms in ~3 s.
- Re-run the risky scenario — dashboard fills with red **blocked** rows.
- Click any row's `tx ↗` — Lora shows the on-chain assertion.

## Beat 2 — AI risk score catches abuse (1:00 – 2:00)

Trigger the burst pattern again. In the audit table point at the
**risk** column — Groq's Llama-3.3 score climbs from 15 → 88 and the
**reason** column shows a human-readable explanation. Middleware
starts escalating instead of paying.

**Say:**
> "Static caps don't catch a prompt-injected agent. The risk service
> looks at recent traffic and explains its verdict — it's auditable,
> not black-box."

## Beat 3 — Human-in-the-loop for expensive ops (2:00 – 2:40)

Run:
```
pnpm --filter @agentguard/demo-agent start escalate
```
- Terminal logs `escalated: intent …`
- Dashboard → **Approvals** — a pending card appears.
- (Optional: mirror phone to projector; Pera notification; approve on phone.)
- Click **Approve** in the dashboard.
- Terminal continues: retry returns 200 with a rendered image URL.
- Lora shows the atomic group `[USDC transfer + record_spend]`.

## Landing (2:40 – 3:00)

**Say:**
> "AgentGuard: the policy layer for agents. Plugs into the x402
> template in one Hono middleware line. Bazaar-listed. Live on TestNet
> right now. Every enterprise deploying agents in 2026 needs this."

## Fallback (if something fails on stage)

1. Pre-recorded 3-min screencast at `demo/fallback.mp4` (record ahead).
2. Cached screenshots at `demo/screens/` for each beat.
3. Post-demo: leave the QR code on the last slide → GitHub gist with
   `curl` command judges can run themselves.

## Bring on stage

- Fully-funded TestNet agent wallet (≥ 5 USDC + 1 ALGO for fees).
- Pera Wallet unlocked on phone AND browser extension.
- Ethernet cable — do not trust venue wifi.
- Backup laptop tethered to phone hotspot.
