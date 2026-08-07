import { Hono } from 'hono';
import { agentsRepo, policiesRepo } from '../repos';
import { parsePolicy, diffPolicies } from '../policy/nl-parser';
import { PolicySchema } from '../policy/schema';
import { allProtectedRoutes } from '../middleware/pricing';
import { invalidateSpendWindow } from '../policy/spend';
import { emit } from './stream';
import { badRequest, notFound } from '../lib/errors';

export const policiesRouter = new Hono();

/**
 * POST /api/policies/from-text/:agentId
 * NL → policy preview. Never applied here — dashboard shows the diff
 * and admin signs the on-chain update from Pera before commit.
 */
policiesRouter.post('/from-text/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  const body = (await c.req.json().catch(() => ({}))) as { prompt?: string };
  if (!body.prompt || body.prompt.trim().length < 3) {
    throw badRequest('prompt required');
  }
  const raw = await agentsRepo.findById(agentId);
  if (!raw) throw notFound(`agent ${agentId} not found`);

  const current = raw.policy
    ? {
        agentAddress: raw.algoAddress,
        dailyCapMicroUsdc: Number(raw.policy.dailyCapMicroUsdc),
        monthlyCapMicroUsdc: Number(raw.policy.monthlyCapMicroUsdc),
        humanThresholdMicroUsdc: Number(raw.policy.humanThresholdMicroUsdc),
        allowedRoutes: raw.policy.allowedRoutes,
        riskThreshold: raw.policy.riskThreshold,
        frozen: raw.status === 'frozen',
      }
    : {
        agentAddress: raw.algoAddress,
        dailyCapMicroUsdc: 0,
        monthlyCapMicroUsdc: 0,
        humanThresholdMicroUsdc: 0,
        allowedRoutes: allProtectedRoutes(),
        riskThreshold: 70,
        frozen: false,
      };

  const after = await parsePolicy({
    current,
    availableRoutes: allProtectedRoutes(),
    prompt: body.prompt,
  });
  const changes = diffPolicies(current, after);
  return c.json({ before: current, after, changes });
});

/**
 * POST /api/policies/:agentId/commit
 * Records the policy off-chain. In production the browser would first
 * post the signed on-chain txn ID and pass it here; the MVP accepts a
 * missing txn ID so the demo doesn't block on chain deployment.
 */
policiesRouter.post('/:agentId/commit', async (c) => {
  const agentId = c.req.param('agentId');
  const body = (await c.req.json().catch(() => ({}))) as {
    policy?: unknown;
    updatedTxnId?: string;
  };
  if (!body.policy) throw badRequest('policy field required');
  const parsed = PolicySchema.parse(body.policy);

  const policy = await policiesRepo.upsertFor(agentId, parsed, body.updatedTxnId ?? null);
  invalidateSpendWindow(agentId);
  emit({
    type: 'policy',
    data: {
      agentId,
      updatedTxnId: body.updatedTxnId ?? null,
      updatedAt: policy.updatedAt.toISOString(),
    },
  });
  return c.json({ ok: true, updatedAt: policy.updatedAt.toISOString() });
});
