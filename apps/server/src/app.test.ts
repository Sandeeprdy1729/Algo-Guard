/**
 * Integration tests — real Supabase, mocked x402 facilitator.
 *
 * We seed a test user + agent + policy in Postgres, then send Hono a
 * synthetic request via `app.fetch` (no port, no real network) and
 * assert (a) HTTP response shape and (b) DB row shape.
 *
 * The AI risk service is skipped: RISK_MIN_AMOUNT_MICRO is bumped high
 * so no call goes out. The x402 payment middleware is replaced with a
 * pass-through so the "allow" branch reaches the handler.
 *
 * Run:
 *   node_modules/.bin/tsx --test src/app.test.ts
 */
import { after, before, describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { config } from 'dotenv';

config();

// Force risk service off — we don't want a network call during tests.
process.env.RISK_MIN_AMOUNT_MICRO = '9999999999';

import { createApp } from './app';
import { prisma } from './chain/prisma';

const A_ADMIN = 'ADMIN' + 'A'.repeat(58 - 5);
const A_MERCHANT = 'RIQPTL7DDHNKGZ7ZAX3M5FRQZFH6QGH4CI2CGSSNJRJKPZLPSKUEVMB2LU';

// Deterministic 58-char TestNet-shaped addresses for the seed rows.
function addr(prefix: string): string {
  return (prefix + 'A'.repeat(58)).slice(0, 58);
}

const AGENT_ADDR_ALLOW    = addr('AGENTALLOWZZ');
const AGENT_ADDR_BLOCK    = addr('AGENTBLOCKZZ');
const AGENT_ADDR_CAP      = addr('AGENTCAPHITZZ');
const AGENT_ADDR_ESCALATE = addr('AGENTESCALATEZ');
const AGENT_ADDR_FROZEN   = addr('AGENTFROZENZZ');
const AGENT_ADDR_UNKNOWN  = addr('AGENTUNKNOWNZ');

let testUserId: string;
const TEST_USER_EMAIL = 'agentguard-test@example.com';

const { app } = createApp({
  avmAddress: A_MERCHANT,
  facilitatorUrl: 'https://facilitator.goplausible.xyz',
  // Any request that reaches here would normally be a paid call; the tests
  // that exercise the "allow" branch call routes with allowed policies but
  // the handlers themselves are what we assert against — so we pass through.
  paymentMiddlewareOverride: () => async (_c: any, next: any) => next(),
});

async function seed(
  address: string,
  policy: {
    dailyCapMicroUsdc: number;
    monthlyCapMicroUsdc: number;
    humanThresholdMicroUsdc: number;
    allowedRoutes?: string[];
  },
  status: 'active' | 'frozen' = 'active'
) {
  const user = await prisma.user.upsert({
    where: { email: TEST_USER_EMAIL },
    create: {
      email: TEST_USER_EMAIL,
      orgName: 'AgentGuard tests',
      algoAdminAddress: A_ADMIN,
    },
    update: {},
  });
  testUserId = user.id;
  const agent = await prisma.agent.upsert({
    where: { algoAddress: address },
    create: {
      userId: user.id,
      name: `test-${address.slice(0, 6)}`,
      algoAddress: address,
      status,
    },
    update: { status },
  });
  await prisma.policy.upsert({
    where: { agentId: agent.id },
    create: {
      agentId: agent.id,
      dailyCapMicroUsdc: BigInt(policy.dailyCapMicroUsdc),
      monthlyCapMicroUsdc: BigInt(policy.monthlyCapMicroUsdc),
      humanThresholdMicroUsdc: BigInt(policy.humanThresholdMicroUsdc),
      allowedRoutes: policy.allowedRoutes ?? ['POST /llm/summarize', 'POST /gpu/render'],
      riskThreshold: 70,
    },
    update: {
      dailyCapMicroUsdc: BigInt(policy.dailyCapMicroUsdc),
      monthlyCapMicroUsdc: BigInt(policy.monthlyCapMicroUsdc),
      humanThresholdMicroUsdc: BigInt(policy.humanThresholdMicroUsdc),
      allowedRoutes: policy.allowedRoutes ?? ['POST /llm/summarize', 'POST /gpu/render'],
    },
  });
  return agent;
}

async function cleanup() {
  // Delete in FK order.
  const testAgents = await prisma.agent.findMany({
    where: { user: { email: TEST_USER_EMAIL } },
    select: { id: true },
  });
  const ids = testAgents.map((a) => a.id);
  if (ids.length) {
    await prisma.approval.deleteMany({
      where: { transaction: { agentId: { in: ids } } },
    });
    await prisma.transaction.deleteMany({ where: { agentId: { in: ids } } });
    await prisma.policy.deleteMany({ where: { agentId: { in: ids } } });
    await prisma.agent.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: TEST_USER_EMAIL } });
}

async function request(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}
): Promise<Response> {
  const res = await app.request(path, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: init.body != null ? JSON.stringify(init.body) : undefined,
  });
  return res as Response;
}

describe('AgentGuard app integration', () => {
  before(async () => {
    await cleanup(); // in case a prior run left rows around
    await seed(AGENT_ADDR_ALLOW, {
      dailyCapMicroUsdc: 1_000_000,
      monthlyCapMicroUsdc: 100_000_000,
      humanThresholdMicroUsdc: 500_000,
    });
    await seed(AGENT_ADDR_BLOCK, {
      dailyCapMicroUsdc: 1_000_000,
      monthlyCapMicroUsdc: 100_000_000,
      humanThresholdMicroUsdc: 500_000,
      allowedRoutes: ['POST /llm/summarize'], // /gpu/render will be blocked
    });
    await seed(AGENT_ADDR_CAP, {
      dailyCapMicroUsdc: 5_000, // $0.005 — one $0.01 call exceeds this
      monthlyCapMicroUsdc: 100_000_000,
      humanThresholdMicroUsdc: 500_000,
    });
    await seed(AGENT_ADDR_ESCALATE, {
      dailyCapMicroUsdc: 100_000_000,
      monthlyCapMicroUsdc: 100_000_000,
      humanThresholdMicroUsdc: 10_000, // /llm/summarize at $0.01 hits threshold
    });
    await seed(
      AGENT_ADDR_FROZEN,
      {
        dailyCapMicroUsdc: 1_000_000,
        monthlyCapMicroUsdc: 100_000_000,
        humanThresholdMicroUsdc: 500_000,
      },
      'frozen'
    );
  });

  after(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  test('GET /health', async () => {
    const r = await request('/health');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.status, 'ok');
    assert.equal(j.service, 'agentguard-server');
  });

  test('unknown 404 returns typed body', async () => {
    const r = await request('/nope');
    assert.equal(r.status, 404);
    const j = await r.json();
    assert.equal(j.code, 'NOT_FOUND');
  });

  test('missing X-Agent-Address → 400 MISSING_AGENT_HEADER', async () => {
    const r = await request('/llm/summarize', { method: 'POST', body: { text: 'x'.repeat(50) } });
    assert.equal(r.status, 400);
    const j = await r.json();
    assert.equal(j.code, 'MISSING_AGENT_HEADER');
    assert.ok(j.requestId, 'requestId echoed');
  });

  test('unknown agent → 403 UNKNOWN_AGENT', async () => {
    const r = await request('/llm/summarize', {
      method: 'POST',
      headers: { 'x-agent-address': AGENT_ADDR_UNKNOWN },
      body: { text: 'x'.repeat(50) },
    });
    assert.equal(r.status, 403);
    const j = await r.json();
    assert.equal(j.code, 'UNKNOWN_AGENT');
  });

  test('route not allow-listed → 403 POLICY_BLOCKED + txn recorded', async () => {
    const r = await request('/gpu/render', {
      method: 'POST',
      headers: { 'x-agent-address': AGENT_ADDR_BLOCK },
      body: { prompt: 'anything' },
    });
    assert.equal(r.status, 403);
    const j = await r.json();
    assert.equal(j.code, 'POLICY_BLOCKED');
    assert.equal(j.verdictCode, 'ROUTE_DISALLOWED');
    assert.match(j.reason, /allow-list/);
    // txn row exists
    const agent = await prisma.agent.findUnique({ where: { algoAddress: AGENT_ADDR_BLOCK } });
    const tx = await prisma.transaction.findFirst({
      where: { agentId: agent!.id, route: 'POST /gpu/render' },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(tx, 'transaction row created');
    assert.equal(tx!.status, 'blocked_policy');
  });

  test('daily cap breach → 403 POLICY_BLOCKED (DAILY_CAP)', async () => {
    const r = await request('/llm/summarize', {
      method: 'POST',
      headers: { 'x-agent-address': AGENT_ADDR_CAP },
      body: { text: 'x'.repeat(50) },
    });
    assert.equal(r.status, 403);
    const j = await r.json();
    assert.equal(j.code, 'POLICY_BLOCKED');
    assert.equal(j.verdictCode, 'DAILY_CAP');
    assert.match(j.reason, /Daily cap/);
  });

  test('escalation threshold → 403 with escalationIntentId', async () => {
    const r = await request('/llm/summarize', {
      method: 'POST',
      headers: { 'x-agent-address': AGENT_ADDR_ESCALATE },
      body: { text: 'x'.repeat(50) },
    });
    assert.equal(r.status, 403);
    const j = await r.json();
    assert.equal(j.code, 'ESCALATION_REQUIRED');
    assert.equal(j.verdictCode, 'HUMAN_THRESHOLD');
    assert.ok(j.escalationIntentId, 'escalation id present');
    assert.ok(j.pollUrl.startsWith('/api/approvals/'), 'poll url present');
    // approval row exists
    const approval = await prisma.approval.findUnique({ where: { id: j.escalationIntentId } });
    assert.ok(approval, 'approval row created');
    assert.equal(approval!.status, 'pending');
  });

  test('frozen agent → 403 POLICY_BLOCKED (FROZEN)', async () => {
    const r = await request('/llm/summarize', {
      method: 'POST',
      headers: { 'x-agent-address': AGENT_ADDR_FROZEN },
      body: { text: 'x'.repeat(50) },
    });
    assert.equal(r.status, 403);
    const j = await r.json();
    assert.equal(j.code, 'POLICY_BLOCKED');
    assert.equal(j.verdictCode, 'FROZEN');
    assert.match(j.reason, /frozen/i);
  });

  test('GET /api/agents lists seeded agents', async () => {
    const r = await request('/api/agents');
    assert.equal(r.status, 200);
    const j = await r.json();
    const addrs = j.agents.map((a: any) => a.algoAddress);
    assert.ok(addrs.includes(AGENT_ADDR_ALLOW));
    assert.ok(addrs.includes(AGENT_ADDR_FROZEN));
    assert.ok(j.availableRoutes.includes('POST /llm/summarize'));
  });

  test('GET /api/audit returns transactions', async () => {
    const r = await request('/api/audit?limit=200');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.ok(Array.isArray(j.transactions));
    // At least the block + cap + escalate rows we created.
    assert.ok(j.transactions.length >= 3);
    for (const t of j.transactions) {
      assert.ok(typeof t.id === 'string');
      assert.ok(typeof t.amountMicroUsdc === 'number');
    }
  });

  test('GET /api/approvals?status=pending lists the escalation', async () => {
    const r = await request('/api/approvals?status=pending');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.ok(j.approvals.some((a: any) => a.transaction.route === 'POST /llm/summarize'));
  });

  test('approve decision transitions status', async () => {
    const list = await request('/api/approvals?status=pending');
    const { approvals } = await list.json();
    const target = approvals.find((a: any) => a.transaction.agentAddress === AGENT_ADDR_ESCALATE);
    assert.ok(target, 'target approval exists');
    const r = await request(`/api/approvals/${target.id}/decision`, {
      method: 'POST',
      body: { decision: 'approved', approverAddress: A_ADMIN, approvalTxnId: 'FAKE_TXN' },
    });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.status, 'approved');
    const refreshed = await request(`/api/approvals/${target.id}`);
    const rj = await refreshed.json();
    assert.equal(rj.status, 'approved');
    assert.equal(rj.approvalTxnId, 'FAKE_TXN');
  });

  test('freeze / unfreeze agent via /api/agents/:id/freeze', async () => {
    const list = await request('/api/agents');
    const { agents } = await list.json();
    const target = agents.find((a: any) => a.algoAddress === AGENT_ADDR_ALLOW);
    assert.ok(target, 'ALLOW agent listed');

    const frz = await request(`/api/agents/${target.id}/freeze`, { method: 'POST' });
    assert.equal(frz.status, 200);
    assert.equal((await frz.json()).status, 'frozen');

    // Now request should be blocked (FROZEN).
    const blocked = await request('/llm/summarize', {
      method: 'POST',
      headers: { 'x-agent-address': AGENT_ADDR_ALLOW },
      body: { text: 'x'.repeat(50) },
    });
    assert.equal(blocked.status, 403);
    const bj = await blocked.json();
    assert.match(bj.reason, /frozen/i);

    const unfrz = await request(`/api/agents/${target.id}/unfreeze`, { method: 'POST' });
    assert.equal((await unfrz.json()).status, 'active');
  });
});
