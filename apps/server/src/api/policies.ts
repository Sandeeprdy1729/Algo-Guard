import { Hono } from 'hono';
import { agentsRepo, policiesRepo, securityEventsRepo } from '../repos';
import { parsePolicy, diffPolicies } from '../policy/nl-parser';
import { PolicySchema, type Policy, type SpendWindow } from '../policy/schema';
import { trace as evaluatePolicyVerbose } from '../policy/engine';
import { allProtectedRoutes, priceForRoute, routeKey } from '../middleware/pricing';
import { getSpendWindow, invalidateSpendWindow } from '../policy/spend';
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
 * POST /api/policies/simulate/:agentId
 *
 * "What would the engine do if this request came in NOW?"
 * Powers the dashboard Policy Evaluation visualiser. Also used by
 * MCP clients to preview a spend decision without submitting one.
 *
 * Body:
 *   {
 *     route:        "POST /llm/summarize" | "GET /..."   (or method + path)
 *     method?:      "POST" | "GET" | ...
 *     path?:        "/llm/summarize"
 *     amountMicroUsdc?: number,   // defaults to the route's real price
 *     riskScore?:   number,       // override — otherwise omitted
 *     riskReason?:  string,
 *     policyOverride?: Partial<Policy>   // sandbox rule-tuning
 *   }
 *
 * The engine call is PURE — no writes, no side effects, safe to call
 * from anywhere. `spend` is read from the same cache the real
 * middleware uses so the numbers match reality.
 */
policiesRouter.post('/simulate/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  const raw = await agentsRepo.findById(agentId);
  if (!raw) throw notFound(`agent ${agentId} not found`);
  if (!raw.policy) throw badRequest('agent has no policy — set one first');

  const body = (await c.req.json().catch(() => ({}))) as {
    route?: string;
    method?: string;
    path?: string;
    amountMicroUsdc?: number;
    riskScore?: number;
    riskReason?: string;
    policyOverride?: Partial<Policy>;
  };

  const route = body.route ?? (
    body.method && body.path ? routeKey(body.method, body.path) : null
  );
  if (!route) throw badRequest('route (or method+path) required');

  const defaultAmount = priceForRoute(route);
  const amountMicroUsdc = body.amountMicroUsdc ?? defaultAmount ?? 0;

  const basePolicy: Policy = {
    agentAddress: raw.algoAddress,
    dailyCapMicroUsdc: Number(raw.policy.dailyCapMicroUsdc),
    monthlyCapMicroUsdc: Number(raw.policy.monthlyCapMicroUsdc),
    humanThresholdMicroUsdc: Number(raw.policy.humanThresholdMicroUsdc),
    allowedRoutes: raw.policy.allowedRoutes,
    riskThreshold: raw.policy.riskThreshold,
    frozen: raw.status === 'frozen',
  };
  const policy: Policy = { ...basePolicy, ...(body.policyOverride ?? {}) };

  const spend: SpendWindow = await getSpendWindow(agentId);

  const trace = evaluatePolicyVerbose({
    policy,
    route,
    amountMicroUsdc,
    spend,
    riskScore: typeof body.riskScore === 'number' ? body.riskScore : undefined,
    riskReason: body.riskReason,
  });

  return c.json({
    agent: { id: raw.id, name: raw.name, address: raw.algoAddress, status: raw.status },
    input: {
      route,
      amountMicroUsdc,
      riskScore: trace.riskScore,
      riskReason: body.riskReason ?? null,
      overrideApplied: !!body.policyOverride,
    },
    trace,
  });
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

  // Record for the agent's Behavior Timeline — best-effort, never
  // blocks the commit path.
  void securityEventsRepo
    .create({
      agentId,
      type: 'policy_updated',
      actor: 'dashboard',
      reason: null,
      metadata: { updatedTxnId: body.updatedTxnId ?? null },
    })
    .catch(() => {});

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
