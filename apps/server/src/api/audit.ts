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

/**
 * GET /api/audit/export.csv — full CSV of the transaction history.
 * Respects the same `agent_id` / `status` filters as `GET /api/audit`
 * but returns up to 10,000 rows so exports capture full history, not
 * just the UI's paginated view.
 */
auditRouter.get('/export.csv', async (c) => {
  const agentId = c.req.query('agent_id') || undefined;
  const status = (c.req.query('status') as TransactionStatus | undefined) || undefined;
  const limit = Math.min(10_000, parseInt(c.req.query('limit') ?? '10000', 10));

  const txns = await transactionsRepo.list({ agentId, status, limit });

  const header = [
    'id',
    'createdAt',
    'settledAt',
    'agentName',
    'agentAddress',
    'route',
    'amountUsdc',
    'amountMicroUsdc',
    'status',
    'riskScore',
    'riskReason',
    'algoTxnId',
    'algoGroupId',
    'latencyMs',
    'loraUrl',
  ];

  const rows = txns.map((t) => [
    t.id,
    t.createdAt,
    t.settledAt ?? '',
    t.agentName ?? '',
    t.agentAddress ?? '',
    t.route,
    (t.amountMicroUsdc / 1_000_000).toFixed(6),
    t.amountMicroUsdc,
    t.status,
    t.riskScore ?? '',
    t.riskReason ?? '',
    t.algoTxnId ?? '',
    t.algoGroupId ?? '',
    t.latencyMs ?? '',
    t.algoTxnId ? loraUrl(t.algoTxnId) : '',
  ]);

  const csv = [header, ...rows].map(rowToCsv).join('\r\n');
  const filename = `agentguard-audit-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
});

/** GET /api/audit/export.json — same rows, JSON array. */
auditRouter.get('/export.json', async (c) => {
  const agentId = c.req.query('agent_id') || undefined;
  const status = (c.req.query('status') as TransactionStatus | undefined) || undefined;
  const limit = Math.min(10_000, parseInt(c.req.query('limit') ?? '10000', 10));

  const txns = await transactionsRepo.list({ agentId, status, limit });
  const enriched = txns.map((t) => ({
    ...t,
    amountUsdc: t.amountMicroUsdc / 1_000_000,
    loraUrl: t.algoTxnId ? loraUrl(t.algoTxnId) : null,
  }));
  const filename = `agentguard-audit-${new Date().toISOString().slice(0, 10)}.json`;

  return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), transactions: enriched }, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
});

/** RFC-4180-style CSV escaping: quote if the field has ", , or newline; escape quotes as "". */
function rowToCsv(row: unknown[]): string {
  return row
    .map((v) => {
      const s = v == null ? '' : String(v);
      if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    })
    .join(',');
}
