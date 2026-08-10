import { Hono } from 'hono';
import { approvalsRepo } from '../repos';
import { notFound } from '../lib/errors';
import { decideApproval } from '../services/approvals';
import type { Env } from '../types';

export const approvalsRouter = new Hono<Env>();

approvalsRouter.get('/', async (c) => {
  const status = (c.req.query('status') ?? 'pending') as
    | 'pending'
    | 'approved'
    | 'denied'
    | 'expired';
  const approvals = await approvalsRepo.listByStatus(status);
  return c.json({ approvals });
});

approvalsRouter.get('/:id', async (c) => {
  const a = await approvalsRepo.findById(c.req.param('id'));
  if (!a) throw notFound('approval not found');
  return c.json(approvalsRepo.serialize(a));
});

approvalsRouter.post('/:id/decision', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    decision?: 'approved' | 'denied';
    approverAddress?: string;
    approvalTxnId?: string;
  };
  const result = await decideApproval(c.req.param('id'), body.decision as any, {
    source: 'dashboard',
    approverAddress: body.approverAddress ?? null,
    approvalTxnId: body.approvalTxnId ?? null,
    requestId: c.get('request')?.requestId,
  });
  if (result.status === 'noop') {
    return c.json({
      ok: false,
      status: result.approval?.status ?? 'unknown',
      reason: result.reason,
    });
  }
  return c.json({ ok: true, status: result.approval.status });
});
