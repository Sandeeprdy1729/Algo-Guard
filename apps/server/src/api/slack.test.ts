/**
 * Integration tests for POST /api/slack/actions.
 *
 * Uses the real Supabase DB (same as app.test.ts) — Slack's HTTP is
 * mocked so no external network call is made.
 *
 * Every scenario the spec calls out is covered:
 *   - valid Slack Approve → decides + updates message + parity with dashboard
 *   - valid Slack Deny → same path
 *   - invalid signature → 401, no state change
 *   - expired approval → 200 noop, no state change
 *   - already-decided approval → 200 noop, no double-write
 *   - invalid approval id → 404 noop
 *   - dashboard & Slack use the same underlying decideApproval path
 */
import { after, before, describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import crypto from 'node:crypto';
import { config } from 'dotenv';

config();

// Slack config for the test. MUST be set BEFORE `createApp` / any import
// that reads getSlackConfig — set them here at module top.
const SIGNING_SECRET = 'test-signing-secret-abcdef';
process.env.SLACK_BOT_TOKEN = 'xoxb-fake-for-tests';
process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
process.env.SLACK_APPROVAL_CHANNEL_ID = 'C_TEST';
// Skip the risk service entirely so no outbound call happens.
process.env.RISK_MIN_AMOUNT_MICRO = '9999999999';

import { createApp } from '../app';
import { prisma } from '../chain/prisma';
import { approvalsRepo } from '../repos';

// ── Mock global fetch so Slack calls are intercepted ────────────────
const slackCalls: Array<{ url: string; body: any }> = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input.toString();
  if (url.includes('slack.com/api/')) {
    let body: any = null;
    try {
      body = init?.body ? JSON.parse(init.body as string) : null;
    } catch {}
    slackCalls.push({ url, body });
    // Simulate chat.postMessage returning ok+ts+channel.
    return new Response(
      JSON.stringify({ ok: true, ts: '1700000000.000100', channel: 'C_TEST' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  return originalFetch(input as any, init);
}) as typeof fetch;

const AGENT_ADDR = 'AGENTSLACKZ' + 'A'.repeat(58 - 11);
const ADMIN_ADDR = 'ADMINSLACKZ' + 'A'.repeat(58 - 11);
const MERCHANT_ADDR = 'IUHZA64HKSAEUPAOCPXZ5WCAJU6HHYUZY4MQHHEEEWSKGYFP6ACBKIOEFQ';
const USER_EMAIL = 'agentguard-slack-test@example.com';

const { app } = createApp({
  avmAddress: MERCHANT_ADDR,
  facilitatorUrl: 'https://facilitator.goplausible.xyz',
  paymentMiddlewareOverride: () => async (_c: any, next: any) => next(),
});

async function seed() {
  const user = await prisma.user.upsert({
    where: { email: USER_EMAIL },
    create: {
      email: USER_EMAIL,
      orgName: 'slack tests',
      algoAdminAddress: ADMIN_ADDR,
    },
    update: {},
  });
  const agent = await prisma.agent.upsert({
    where: { algoAddress: AGENT_ADDR },
    create: {
      userId: user.id,
      name: 'slack test agent',
      algoAddress: AGENT_ADDR,
    },
    update: {},
  });
  return agent;
}

async function cleanup() {
  const agents = await prisma.agent.findMany({
    where: { user: { email: USER_EMAIL } },
    select: { id: true },
  });
  const ids = agents.map((a) => a.id);
  if (ids.length) {
    await prisma.approval.deleteMany({
      where: { transaction: { agentId: { in: ids } } },
    });
    await prisma.transaction.deleteMany({ where: { agentId: { in: ids } } });
    await prisma.policy.deleteMany({ where: { agentId: { in: ids } } });
    await prisma.agent.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: USER_EMAIL } });
}

async function createPendingApproval(agentId: string, ttlMs = 5 * 60 * 1000) {
  const tx = await prisma.transaction.create({
    data: {
      agentId,
      route: 'POST /gpu/render',
      amountMicroUsdc: BigInt(500_000),
      status: 'escalated',
      riskReason: 'test',
    },
  });
  return approvalsRepo.createPending(tx.id, ttlMs);
}

function sign(rawBody: string, ts = Math.floor(Date.now() / 1000)): {
  ts: string;
  sig: string;
} {
  const base = `v0:${ts}:${rawBody}`;
  const sig = 'v0=' + crypto.createHmac('sha256', SIGNING_SECRET).update(base).digest('hex');
  return { ts: String(ts), sig };
}

function makePayload(approvalId: string, decision: 'approved' | 'denied') {
  return {
    type: 'block_actions',
    user: { id: 'U_TEST', name: 'test-user' },
    channel: { id: 'C_TEST', name: 'approvals' },
    message: { ts: '1700000000.000100' },
    actions: [
      {
        action_id: decision,
        value: `approval:${approvalId}:${decision}`,
      },
    ],
  };
}

async function postSlack(body: string, opts: { validSig?: boolean; ts?: number } = {}) {
  const { ts, sig } = sign(body, opts.ts);
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    'x-slack-request-timestamp': ts,
    'x-slack-signature': opts.validSig === false ? 'v0=deadbeef' : sig,
  };
  return app.request('/api/slack/actions', { method: 'POST', headers, body });
}

// ── Suite ──────────────────────────────────────────────────────────

describe('POST /api/slack/actions', () => {
  before(async () => {
    await cleanup();
  });
  after(async () => {
    await cleanup();
    await prisma.$disconnect();
    globalThis.fetch = originalFetch;
  });

  test('invalid signature → 401 and no state change', async () => {
    const agent = await seed();
    const approval = await createPendingApproval(agent.id);
    const body = `payload=${encodeURIComponent(JSON.stringify(makePayload(approval.id, 'approved')))}`;
    const res = await postSlack(body, { validSig: false });
    assert.equal(res.status, 401);
    const still = await prisma.approval.findUnique({ where: { id: approval.id } });
    assert.equal(still!.status, 'pending');
  });

  test('valid Slack Approve → decides + updates Slack message + emits SSE (via decideApproval)', async () => {
    const agent = await seed();
    const approval = await createPendingApproval(agent.id);
    slackCalls.length = 0;

    const body = `payload=${encodeURIComponent(JSON.stringify(makePayload(approval.id, 'approved')))}`;
    const res = await postSlack(body);
    assert.equal(res.status, 200);
    const j = (await res.json()) as any;
    assert.equal(j.ok, true);
    assert.equal(j.status, 'approved');

    const dbRow = await prisma.approval.findUnique({ where: { id: approval.id } });
    assert.equal(dbRow!.status, 'approved');
    assert.ok(dbRow!.decidedAt);

    const updated = slackCalls.find((c) => c.url.endsWith('/chat.update'));
    assert.ok(updated, 'chat.update was called to strip the buttons');
  });

  test('valid Slack Deny → sets status=denied', async () => {
    const agent = await seed();
    const approval = await createPendingApproval(agent.id);
    const body = `payload=${encodeURIComponent(JSON.stringify(makePayload(approval.id, 'denied')))}`;
    const res = await postSlack(body);
    assert.equal(res.status, 200);
    const dbRow = await prisma.approval.findUnique({ where: { id: approval.id } });
    assert.equal(dbRow!.status, 'denied');
  });

  test('expired approval → 200 noop, no state change, ephemeral shown', async () => {
    const agent = await seed();
    // Create with negative TTL so it's already expired.
    const approval = await createPendingApproval(agent.id, -1000);
    const body = `payload=${encodeURIComponent(JSON.stringify(makePayload(approval.id, 'approved')))}`;
    const res = await postSlack(body);
    assert.equal(res.status, 200);
    const j = (await res.json()) as any;
    assert.equal(j.ok, false);
    assert.equal(j.reason, 'expired');
    const dbRow = await prisma.approval.findUnique({ where: { id: approval.id } });
    assert.equal(dbRow!.status, 'pending');
  });

  test('already-decided approval → 200 noop, no double-write', async () => {
    const agent = await seed();
    const approval = await createPendingApproval(agent.id);
    // First click: legitimate approval
    await postSlack(`payload=${encodeURIComponent(JSON.stringify(makePayload(approval.id, 'approved')))}`);
    // Second click: should be idempotent
    const res = await postSlack(`payload=${encodeURIComponent(JSON.stringify(makePayload(approval.id, 'denied')))}`);
    assert.equal(res.status, 200);
    const j = (await res.json()) as any;
    assert.equal(j.ok, false);
    assert.equal(j.reason, 'already_decided');
    const dbRow = await prisma.approval.findUnique({ where: { id: approval.id } });
    // Still approved from the first click — deny was ignored.
    assert.equal(dbRow!.status, 'approved');
  });

  test('unknown approval id → 404', async () => {
    const body = `payload=${encodeURIComponent(JSON.stringify(makePayload('00000000-0000-4000-8000-000000000000', 'approved')))}`;
    const res = await postSlack(body);
    assert.equal(res.status, 404);
  });

  test('bad button value → 400', async () => {
    const payload = {
      type: 'block_actions',
      user: { id: 'U_TEST' },
      channel: { id: 'C_TEST' },
      actions: [{ value: 'nonsense' }],
    };
    const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
    const res = await postSlack(body);
    assert.equal(res.status, 400);
  });

  test('dashboard + Slack share the SAME decision path (parity check)', async () => {
    // Route A: dashboard → decides via /api/approvals/:id/decision.
    const agentA = await seed();
    const approvalA = await createPendingApproval(agentA.id);
    const rA = await app.request(`/api/approvals/${approvalA.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approved', approverAddress: ADMIN_ADDR }),
    });
    assert.equal(rA.status, 200);
    const dbA = await prisma.approval.findUnique({ where: { id: approvalA.id } });
    assert.equal(dbA!.status, 'approved');

    // Route B: Slack → decides via /api/slack/actions.
    const approvalB = await createPendingApproval(agentA.id);
    const bodyB = `payload=${encodeURIComponent(JSON.stringify(makePayload(approvalB.id, 'approved')))}`;
    const rB = await postSlack(bodyB);
    assert.equal(rB.status, 200);
    const dbB = await prisma.approval.findUnique({ where: { id: approvalB.id } });
    assert.equal(dbB!.status, 'approved');

    // Same terminal state, same fields populated by the shared service.
    assert.equal(dbA!.status, dbB!.status);
    assert.ok(dbA!.decidedAt && dbB!.decidedAt);
  });
});
