/**
 * Runs AFTER paymentMiddleware. If payment settled, x402 puts settlement
 * info on the response headers (PAYMENT-RESPONSE). We turn that into a
 * `transactions` row (status=settled) and broadcast on SSE.
 *
 * If payment failed inside x402, paymentMiddleware surfaces the error
 * and this simply records nothing extra.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { emit } from '../api/stream';
import type { Env } from '../types';
import { log } from '../lib/logger';
import { transactionsRepo } from '../repos';

export const auditMiddleware: MiddlewareHandler<Env> = async (c: Context<Env>, next) => {
  await next();

  const gctx = c.get('agentGuard');
  if (!gctx) return;

  const status = c.res.status;
  if (status < 200 || status >= 300) return;

  const paymentHeader =
    c.res.headers.get('x-payment-response') ??
    c.res.headers.get('payment-response') ??
    null;
  const { txnId, groupId } = parsePaymentResponse(paymentHeader);

  const tx = await transactionsRepo.create({
    agentId: gctx.agentId,
    route: gctx.route,
    amountMicroUsdc: gctx.amountMicroUsdc,
    status: 'settled',
    riskScore: gctx.riskScore,
    riskReason: gctx.riskReason,
    algoTxnId: txnId,
    algoGroupId: groupId,
    latencyMs: Date.now() - gctx.startedAt,
    settledAt: new Date(),
  });
  emit({ type: 'transaction', data: transactionsRepo.serialize(tx) });
  log.info('audit.settled', {
    requestId: c.get('request')?.requestId,
    agentId: gctx.agentId,
    txnId,
    amountMicroUsdc: gctx.amountMicroUsdc,
  });
};

function parsePaymentResponse(header: string | null): {
  txnId: string | null;
  groupId: string | null;
} {
  if (!header) return { txnId: null, groupId: null };
  try {
    const jsonStr = Buffer.from(header, 'base64').toString('utf8');
    const parsed = JSON.parse(jsonStr) as { transaction?: string; groupId?: string };
    return { txnId: parsed.transaction ?? null, groupId: parsed.groupId ?? null };
  } catch {
    return { txnId: null, groupId: null };
  }
}
