import { Hono } from 'hono';
import { agentsRepo, approvalsRepo, securityEventsRepo, transactionsRepo } from '../repos';
import { getSpendWindow } from '../policy/spend';
import { allProtectedRoutes } from '../middleware/pricing';
import { badRequest, notFound } from '../lib/errors';
import { setAgentStatus } from '../services/agent-status';
import type { Env } from '../types';

export const agentsRouter = new Hono<Env>();

/** GET /api/agents — list with live spend + available routes. */
agentsRouter.get('/', async (c) => {
  const agents = await agentsRepo.list();
  const enriched = await Promise.all(
    agents.map(async (a) => ({
      ...a,
      spend: await getSpendWindow(a.id),
    }))
  );
  return c.json({ agents: enriched, availableRoutes: allProtectedRoutes() });
});

/** GET /api/agents/:id — detail + last 50 transactions. */
agentsRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const raw = await agentsRepo.findById(id);
  if (!raw) throw notFound(`agent ${id} not found`);
  const dto = agentsRepo.serialize(raw);
  const transactions = await transactionsRepo.list({ agentId: id, limit: 50 });
  const spend = await getSpendWindow(id);
  return c.json({ ...dto, transactions, spend });
});

/** POST /api/agents — register a new agent (dashboard admin action). */
agentsRouter.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const required = ['userEmail', 'adminAddress', 'name', 'algoAddress'] as const;
  for (const k of required) {
    if (typeof body[k] !== 'string' || !body[k]) throw badRequest(`missing ${k}`);
  }
  if (body.algoAddress.length !== 58) throw badRequest('algoAddress must be 58 characters');
  const agent = await agentsRepo.create({
    userEmail: body.userEmail,
    orgName: body.orgName ?? null,
    adminAddress: body.adminAddress,
    name: body.name,
    algoAddress: body.algoAddress,
    metadata: body.metadata,
  });
  return c.json({ id: agent.id, algoAddress: agent.algoAddress }, 201);
});

/**
 * POST /api/agents/:id/freeze
 *
 * Kill-switch. Routes through the shared setAgentStatus service so
 * dashboard clicks, Slack actions, MCP calls, and future admin CLIs
 * all hit the same invariants (idempotency, SecurityEvent, SSE,
 * spend-cache invalidation).
 *
 * Response shape:
 *   { id, status, changed: boolean }
 */
agentsRouter.post('/:id/freeze', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    actor?: string;
    reason?: string;
  };
  const result = await setAgentStatus(c.req.param('id'), 'frozen', {
    actor: body.actor ?? 'dashboard',
    reason: body.reason ?? null,
    requestId: c.get('request')?.requestId,
  });
  return c.json({
    id: result.agent.id,
    status: result.agent.status,
    changed: result.status === 'changed',
  });
});

agentsRouter.post('/:id/unfreeze', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    actor?: string;
    reason?: string;
  };
  const result = await setAgentStatus(c.req.param('id'), 'active', {
    actor: body.actor ?? 'dashboard',
    reason: body.reason ?? null,
    requestId: c.get('request')?.requestId,
  });
  return c.json({
    id: result.agent.id,
    status: result.agent.status,
    changed: result.status === 'changed',
  });
});

/**
 * GET /api/agents/:id/timeline
 *
 * Chronological, mixed-source activity feed for a single agent. Merges:
 *   - transactions (paid, blocked_policy, blocked_risk, escalated)
 *   - approvals    (pending, approved, denied, expired)
 *   - securityEvents (freeze, unfreeze, policy_updated)
 *
 * The dashboard's "Agent Behavior Timeline" is the primary consumer.
 * All three sources are already indexed by agentId + createdAt, so this
 * is cheap; no aggregate table needed.
 */
agentsRouter.get('/:id/timeline', async (c) => {
  const id = c.req.param('id');
  const raw = await agentsRepo.findById(id);
  if (!raw) throw notFound(`agent ${id} not found`);
  const limit = Math.min(200, Number(c.req.query('limit') ?? 100));

  const [txns, approvals, security] = await Promise.all([
    transactionsRepo.list({ agentId: id, limit }),
    approvalsRepo.listByAgent(id, limit).catch(() => []),
    securityEventsRepo.listByAgent(id, limit),
  ]);

  type TimelineEntry = {
    kind: 'transaction' | 'approval' | 'security';
    id: string;
    at: string;
    summary: string;
    tone: 'success' | 'warn' | 'block' | 'info';
    detail: Record<string, unknown>;
  };

  const entries: TimelineEntry[] = [];

  for (const t of txns) {
    const tone: TimelineEntry['tone'] =
      t.status === 'settled' || t.status === 'paid' ? 'success'
      : t.status === 'escalated'                    ? 'warn'
      : t.status.startsWith('blocked')              ? 'block'
      : 'info';
    entries.push({
      kind: 'transaction',
      id: t.id,
      at: t.createdAt,
      summary: `${t.status.toUpperCase()} ${t.route} — $${(t.amountMicroUsdc / 1_000_000).toFixed(4)}`,
      tone,
      detail: {
        route: t.route,
        amountMicroUsdc: t.amountMicroUsdc,
        status: t.status,
        riskScore: t.riskScore,
        riskReason: t.riskReason,
        algoTxnId: t.algoTxnId,
      },
    });
  }

  for (const a of approvals) {
    const tone: TimelineEntry['tone'] =
      a.status === 'approved' ? 'success'
      : a.status === 'denied' ? 'block'
      : a.status === 'expired' ? 'info'
      : 'warn';
    entries.push({
      kind: 'approval',
      id: a.id,
      at: a.decidedAt ?? a.createdAt,
      summary: `Approval ${a.status.toUpperCase()} — ${a.transaction.route} $${(a.transaction.amountMicroUsdc / 1_000_000).toFixed(4)}`,
      tone,
      detail: {
        approvalId: a.id,
        status: a.status,
        approvalTxnId: a.approvalTxnId,
        route: a.transaction.route,
        amountMicroUsdc: a.transaction.amountMicroUsdc,
      },
    });
  }

  for (const s of security) {
    const tone: TimelineEntry['tone'] =
      s.type === 'freeze' ? 'block'
      : s.type === 'unfreeze' ? 'success'
      : 'info';
    entries.push({
      kind: 'security',
      id: s.id,
      at: s.createdAt,
      summary: securitySummary(s.type, s.actor),
      tone,
      detail: { type: s.type, actor: s.actor, reason: s.reason, metadata: s.metadata },
    });
  }

  entries.sort((a, b) => b.at.localeCompare(a.at));
  return c.json({
    agent: { id: raw.id, name: raw.name, status: raw.status },
    entries: entries.slice(0, limit),
  });
});

function securitySummary(type: string, actor: string | null): string {
  const who = actor ? ` by ${actor}` : '';
  switch (type) {
    case 'freeze':          return `Agent FROZEN${who}`;
    case 'unfreeze':        return `Agent UNFROZEN${who}`;
    case 'policy_updated':  return `Policy updated${who}`;
    default:                return `${type}${who}`;
  }
}
