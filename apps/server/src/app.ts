/**
 * Assembles the Hono app.
 *
 * Extracted from index.ts so integration tests can boot the app
 * in-process without opening a network port.
 *
 * Middleware order:
 *   1. request context     — requestId, structured log
 *   2. CORS                — wildcard so x402 headers survive browsers
 *   3. error handler       — via app.onError
 *   4. policyMiddleware    — AgentGuard pre-flight (agent + risk + engine)
 *   5. paymentMiddleware   — @x402/hono (unchanged from template)
 *   6. auditMiddleware     — AgentGuard post-settle (record + SSE)
 *   7. route handlers      — /llm/summarize, /gpu/render
 *   8. dashboard REST + SSE — /api/*
 *   9. /health, /info, notFound
 */
import { Hono } from 'hono';
import { paymentMiddleware } from '@x402/hono';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import type { ResourceServerExtension } from '@x402/core/types';
import { ExactAvmScheme } from '@x402/avm/exact/server';
import { ALGORAND_TESTNET_CAIP2 } from '@x402/avm';
import { bazaarResourceServerExtension } from '@x402-avm/extensions';

import { handleLlmSummarize } from './handlers/llm';
import { handleGpuRender } from './handlers/gpu';
import createPaymentConfig, { EndpointConfig } from './endpoints.config';

import { policyMiddleware } from './middleware/policy';
import { auditMiddleware } from './middleware/audit';
import { requestContextMiddleware } from './middleware/request-context';
import { mountDashboardApi } from './api';
import { AppError } from './lib/errors';
import { log } from './lib/logger';
import type { Env } from './types';

export interface AppOptions {
  avmAddress: string;
  facilitatorUrl: string;
  /** Provide to bypass real x402 payment middleware — used by integration tests. */
  paymentMiddlewareOverride?: (paymentConfig: EndpointConfig) => (c: any, next: any) => Promise<any>;
}

export function createApp(opts: AppOptions) {
  const facilitatorClient = new HTTPFacilitatorClient({ url: opts.facilitatorUrl });
  const x402Server = new x402ResourceServer(facilitatorClient)
    .register(ALGORAND_TESTNET_CAIP2, new ExactAvmScheme())
    .registerExtension(bazaarResourceServerExtension as unknown as ResourceServerExtension);

  const app = new Hono<Env>();

  // 1. request context (must be first — sets requestId used by log lines)
  app.use('*', requestContextMiddleware);

  // 2. CORS
  app.use('*', async (c, next) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE, HEAD',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': '*',
      'Access-Control-Max-Age': '86400',
    };
    if (c.req.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: cors });
    }
    Object.entries(cors).forEach(([k, v]) => c.header(k, v));
    await next();
  });

  // 3. Unified error handler
  app.onError((err, c) => {
    const requestId = c.get('request')?.requestId;
    if (err instanceof AppError) {
      log.warn('app.error', { requestId, code: err.code, msg: err.message });
      return c.json(err.toJSON(requestId), err.status as any);
    }
    log.error('unhandled', {
      requestId,
      name: err.name,
      msg: err.message,
      stack: err.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return c.json(
      { error: 'Internal server error', code: 'INTERNAL', requestId },
      500
    );
  });

  // 4. policy
  app.use('*', policyMiddleware);

  // 5. x402 (real, or test override)
  const paymentConfig: EndpointConfig = createPaymentConfig(opts.avmAddress);
  const paymentMw = opts.paymentMiddlewareOverride
    ? opts.paymentMiddlewareOverride(paymentConfig)
    : (paymentMiddleware(paymentConfig as any, x402Server) as any);
  app.use(paymentMw);

  // 6. audit
  app.use('*', auditMiddleware);

  // 7. protected handlers
  app.post('/llm/summarize', handleLlmSummarize);
  app.post('/gpu/render', handleGpuRender);

  // 8. dashboard API
  mountDashboardApi(app);

  // 9. public endpoints + 404
  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      service: 'agentguard-server',
      uptime: process.uptime(),
      pid: process.pid,
    })
  );

  app.get('/info', (c) =>
    c.json({
      service: 'agentguard-server',
      version: '0.1.0',
      network: 'Algorand TestNet',
      receiver: opts.avmAddress,
      endpoints: Object.keys(paymentConfig),
      dashboard: 'GET /api/agents, GET /api/audit, GET /api/stream (SSE)',
    })
  );

  app.notFound((c) =>
    c.json(
      {
        error: 'Endpoint not found',
        code: 'NOT_FOUND',
        path: c.req.path,
        hint: 'GET /health, GET /info, GET /api/agents',
      },
      404
    )
  );

  return { app, paymentConfig };
}
