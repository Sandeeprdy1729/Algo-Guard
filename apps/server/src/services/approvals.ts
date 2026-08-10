/**
 * decideApproval — the single approval-decision code path.
 *
 * Called by BOTH the dashboard route (POST /api/approvals/:id/decision)
 * AND the Slack action handler (POST /api/slack/actions). Never bypassed.
 *
 * Contract:
 *   - Idempotent: if the approval is already decided or expired, no DB
 *     write happens and we return { status: 'noop', current: <approval> }.
 *   - Emits SSE + invalidates the spend cache exactly ONCE per real
 *     state transition.
 *   - Returns a discriminated result so callers (Slack handler) can show
 *     the right message when the click was a no-op.
 */
import { approvalsRepo } from '../repos';
import { invalidateSpendWindow } from '../policy/spend';
import { emit } from '../api/stream';
import { log } from '../lib/logger';
import { badRequest, notFound } from '../lib/errors';

export type ApprovalSource = 'dashboard' | 'slack';

export type DecideResult =
  | {
      status: 'decided';
      approval: Awaited<ReturnType<typeof approvalsRepo.decide>>;
      priorStatus: 'pending';
    }
  | {
      status: 'noop';
      reason: 'already_decided' | 'expired';
      approval: Awaited<ReturnType<typeof approvalsRepo.findById>>;
    };

export interface DecideOptions {
  approverAddress?: string | null;
  approvalTxnId?: string | null;
  /** Free-form identifier so the audit log can distinguish sources. */
  source: ApprovalSource;
  /** Correlation id for tracing (e.g. Hono requestId). */
  requestId?: string;
}

export async function decideApproval(
  id: string,
  decision: 'approved' | 'denied',
  opts: DecideOptions,
): Promise<DecideResult> {
  if (decision !== 'approved' && decision !== 'denied') {
    throw badRequest('decision must be "approved" or "denied"');
  }
  const existing = await approvalsRepo.findById(id);
  if (!existing) throw notFound(`approval ${id} not found`);

  // Idempotency: never overwrite a terminal state.
  if (existing.status !== 'pending') {
    log.info('approval.noop', {
      requestId: opts.requestId,
      approvalId: id,
      priorStatus: existing.status,
      source: opts.source,
      attemptedDecision: decision,
    });
    return { status: 'noop', reason: 'already_decided', approval: existing };
  }

  // Expiry guard — user could click a Slack button after TTL passed.
  if (existing.expiresAt.getTime() <= Date.now()) {
    log.info('approval.expired', {
      requestId: opts.requestId,
      approvalId: id,
      source: opts.source,
    });
    return { status: 'noop', reason: 'expired', approval: existing };
  }

  const approval = await approvalsRepo.decide(
    id,
    decision,
    opts.approverAddress ?? null,
    opts.approvalTxnId ?? null,
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
      source: opts.source,
    },
  });
  log.info('approval.decided', {
    requestId: opts.requestId,
    approvalId: id,
    decision,
    source: opts.source,
  });
  return { status: 'decided', approval, priorStatus: 'pending' };
}
