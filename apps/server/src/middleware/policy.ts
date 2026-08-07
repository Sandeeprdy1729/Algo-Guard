/**
 * AgentGuard policy middleware.
 *
 * Runs BEFORE @x402/hono's paymentMiddleware. Responsibilities:
 *   1. Identify the agent from the `X-Agent-Address` header.
 *   2. Look up its policy (Postgres mirror of the on-chain box).
 *   3. Compute the pending amount from the route pricing table.
 *   4. Call the AI risk service (only above RISK_MIN_AMOUNT_MICRO).
 *   5. Evaluate the deterministic policy engine.
 *   6. On block: return 403 immediately, saving the agent a signature.
 *      On escalate: create an approval intent and return 402 with the
 *      intent id so the client polls / retries after human approval.
 *      On allow: pass through so paymentMiddleware handles the 402 dance.
 *
 * Bypasses:
 *   /api/*, /health, /info, /.well-known — non-agent surface.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { evaluate } from '../policy/engine';
import { emit } from '../api/stream';
import { getSpendWindow } from '../policy/spend';
import { fetchRiskScore } from './risk';
import { priceForRoute, routeKey } from './pricing';
import type { Env } from '../types';
import { log } from '../lib/logger';
import { AppError, badRequest } from '../lib/errors';
import { agentsRepo, approvalsRepo, transactionsRepo } from '../repos';

const RISK_MIN = parseInt(process.env.RISK_MIN_AMOUNT_MICRO ?? '10000', 10);
const AGENT_HEADER = 'x-agent-address';
const ESCALATION_TTL_MS = 5 * 60 * 1000;

export const policyMiddleware: MiddlewareHandler<Env> = async (
  c: Context<Env>,
  next
) => {
  const path = c.req.path;
  const method = c.req.method.toUpperCase();

  // Bypass non-protected surface.
  if (
    path.startsWith('/api/') ||
    path.startsWith('/health') ||
    path.startsWith('/info') ||
    path === '/' ||
    path.startsWith('/.well-known')
  ) {
    return next();
  }

  const route = routeKey(method, path);
  const priceMicro = priceForRoute(route);
  if (priceMicro === null) {
    // Unknown route — let Hono's notFound handle it later.
    return next();
  }

  const agentAddress = c.req.header(AGENT_HEADER);
  if (!agentAddress) {
    throw new AppError(
      'MISSING_AGENT_HEADER',
      'AgentGuard requires X-Agent-Address header',
      400,
      { hint: 'Send the address the agent will sign the x402 payment with.' }
    );
  }
  if (agentAddress.length !== 58) throw badRequest('X-Agent-Address must be 58 chars');

  const agent = await agentsRepo.findByAddress(agentAddress);
  if (!agent || !agent.policy) {
    throw new AppError(
      'UNKNOWN_AGENT',
      'Agent not registered with AgentGuard',
      403,
      { agentAddress, hint: 'Register the agent in the dashboard and set a policy.' }
    );
  }

  const spend = await getSpendWindow(agent.id);

  const risk =
    priceMicro >= RISK_MIN
      ? await fetchRiskScore({
          agentId: agent.id,
          agentAddress,
          route,
          amountMicroUsdc: priceMicro,
        }).catch((err) => {
          log.warn('risk.unavailable', {
            requestId: c.get('request')?.requestId,
            agentAddress,
            msg: (err as Error).message,
          });
          return undefined;
        })
      : undefined;

  const verdict = evaluate({
    policy: {
      agentAddress,
      dailyCapMicroUsdc: Number(agent.policy.dailyCapMicroUsdc),
      monthlyCapMicroUsdc: Number(agent.policy.monthlyCapMicroUsdc),
      humanThresholdMicroUsdc: Number(agent.policy.humanThresholdMicroUsdc),
      allowedRoutes: agent.policy.allowedRoutes,
      riskThreshold: agent.policy.riskThreshold,
      frozen: agent.status === 'frozen',
    },
    route,
    amountMicroUsdc: priceMicro,
    spend,
    riskScore: risk?.score,
    riskReason: risk?.reason,
  });

  if (verdict.action === 'block') {
    const status = verdict.code === 'RISK' ? 'blocked_risk' : 'blocked_policy';
    const tx = await transactionsRepo.create({
      agentId: agent.id,
      route,
      amountMicroUsdc: priceMicro,
      status,
      riskScore: risk?.score ?? null,
      riskReason: verdict.reason,
    });
    emit({ type: 'transaction', data: transactionsRepo.serialize({ ...tx, agent }) });
    log.info('policy.block', {
      requestId: c.get('request')?.requestId,
      agentId: agent.id,
      code: verdict.code,
      route,
    });
    throw new AppError(
      verdict.code === 'RISK' ? 'RISK_BLOCKED' : 'POLICY_BLOCKED',
      'AgentGuard policy blocked this request',
      403,
      { verdictCode: verdict.code, reason: verdict.reason, transactionId: tx.id }
    );
  }

  if (verdict.action === 'escalate') {
    const tx = await transactionsRepo.create({
      agentId: agent.id,
      route,
      amountMicroUsdc: priceMicro,
      status: 'escalated',
      riskScore: risk?.score ?? null,
      riskReason: verdict.reason,
    });
    const approval = await approvalsRepo.createPending(tx.id, ESCALATION_TTL_MS);
    emit({ type: 'transaction', data: transactionsRepo.serialize({ ...tx, agent }) });
    emit({
      type: 'approval',
      data: { id: approval.id, transactionId: tx.id, status: 'pending' },
    });
    log.info('policy.escalate', {
      requestId: c.get('request')?.requestId,
      agentId: agent.id,
      code: verdict.code,
      approvalId: approval.id,
    });
    return c.json(
      {
        x402Version: 1,
        error: 'Payment escalated to human approval',
        code: 'ESCALATION_REQUIRED' as const,
        verdictCode: verdict.code,
        reason: verdict.reason,
        escalationIntentId: approval.id,
        expiresAt: approval.expiresAt.toISOString(),
        pollUrl: `/api/approvals/${approval.id}`,
      },
      402
    );
  }

  // Allow — stash context for the audit middleware.
  c.set('agentGuard', {
    agentId: agent.id,
    agentAddress,
    route,
    amountMicroUsdc: priceMicro,
    riskScore: risk?.score ?? null,
    riskReason: risk?.reason ?? null,
    startedAt: Date.now(),
  });

  await next();
};
