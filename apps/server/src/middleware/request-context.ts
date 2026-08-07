/**
 * Request-scoped context: assigns a requestId and a per-request logger.
 * Combined with the typed error handler in `errors.ts`, every response
 * carries a `requestId` clients can quote when reporting bugs.
 */
import type { Context, MiddlewareHandler } from 'hono';
import crypto from 'node:crypto';
import { log } from '../lib/logger';

export interface RequestCtx {
  requestId: string;
  startedAt: number;
}

export type Env = {
  Variables: {
    request: RequestCtx;
    agentGuard?: {
      agentId: string;
      agentAddress: string;
      route: string;
      amountMicroUsdc: number;
      riskScore: number | null;
      riskReason: string | null;
      startedAt: number;
    };
  };
};

export const requestContextMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
  const startedAt = Date.now();
  c.set('request', { requestId, startedAt });
  c.header('x-request-id', requestId);

  log.info('req.start', {
    requestId,
    method: c.req.method,
    path: c.req.path,
    hasPaymentSig: c.req.header('payment-signature') != null,
    hasAgentAddress: c.req.header('x-agent-address')?.slice(0, 8) ?? null,
  });

  try {
    await next();
  } finally {
    log.info('req.end', {
      requestId,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
    });
  }
};
