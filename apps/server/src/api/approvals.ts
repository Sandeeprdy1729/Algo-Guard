import { Hono } from 'hono';
import { approvalsRepo } from '../repos';
import { emit } from './stream';
import { invalidateSpendWindow } from '../policy/spend';
import { badRequest, notFound } from '../lib/errors';

export const approvalsRouter = new Hono();

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
  if (body.decision !== 'approved' && body.decision !== 'denied') {
    throw badRequest('decision must be "approved" or "denied"');
  }
  const approval = await approvalsRepo.decide(
    c.req.param('id'),
    body.decision,
    body.approverAddress ?? null,
    body.approvalTxnId ?? null
  );
  invalidateSpendWindow(approval.transaction.agentId);
  emit({
    type: 'approval',
    data: {
      id: approval.id,
      status: approval.status,
      transactionId: approval.transactionId,
      approvalTxnId: approval.approvalTxnId,
      decidedAt: approval.decidedAt?.toISOString() ?? null,
    },
  });
  return c.json({ ok: true, status: approval.status });
});
