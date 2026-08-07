import { Hono } from 'hono';
import type { TransactionStatus } from '@prisma/client';
import { transactionsRepo, auditLogsRepo } from '../repos';
import { loraUrl } from '../chain/client';

export const auditRouter = new Hono();

/** GET /api/audit — transactions the middleware saw. */
auditRouter.get('/', async (c) => {
  const agentId = c.req.query('agent_id') || undefined;
  const status = (c.req.query('status') as TransactionStatus | undefined) || undefined;
  const limit = Math.min(200, parseInt(c.req.query('limit') ?? '50', 10));

  const txns = await transactionsRepo.list({ agentId, status, limit });
  return c.json({
    transactions: txns.map((t) => ({
      ...t,
      loraUrl: t.algoTxnId ? loraUrl(t.algoTxnId) : null,
    })),
  });
});

/** GET /api/audit/chain — materialized on-chain log() events. */
auditRouter.get('/chain', async (c) => {
  const limit = Math.min(200, parseInt(c.req.query('limit') ?? '50', 10));
  const rows = await auditLogsRepo.list(limit);
  return c.json({
    logs: rows.map((r) => ({
      ...r,
      loraUrl: r.algoTxnId ? loraUrl(r.algoTxnId) : null,
    })),
  });
});
