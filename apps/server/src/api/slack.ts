/**
 * POST /api/slack/actions
 *
 * Slack's interactive-message callback. Signature-verified and rate-
 * safe. Delegates the actual decision to the same service the dashboard
 * uses (services/approvals.decideApproval) so both interfaces stay in
 * lockstep.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { log } from '../lib/logger';
import { badRequest } from '../lib/errors';
import {
  buildDecidedBlocks,
  getSlackConfig,
  parseButtonValue,
  postEphemeral,
  updateApprovalMessage,
  verifySlackSignature,
  type ApprovalNotificationInput,
} from '../lib/slack';
import { decideApproval } from '../services/approvals';
import { approvalsRepo } from '../repos';

export const slackRouter = new Hono<Env>();

slackRouter.post('/actions', async (c) => {
  const requestId = c.get('request')?.requestId;

  // Slack sends application/x-www-form-urlencoded with a single `payload=`
  // field containing the JSON. We need the raw body for signature verify.
  const rawBody = await c.req.text();

  const check = verifySlackSignature(
    rawBody,
    c.req.header('x-slack-request-timestamp') ?? null,
    c.req.header('x-slack-signature') ?? null,
  );
  if (!check.ok) {
    log.warn('slack.signature_rejected', { requestId, reason: check.reason });
    return c.json({ error: 'invalid_signature', reason: check.reason }, 401);
  }

  const parsed = parseFormPayload(rawBody);
  if (!parsed) throw badRequest('missing payload');
  const { payload } = parsed;

  const action = payload.actions?.[0];
  if (!action?.value) {
    log.warn('slack.missing_action', { requestId });
    return c.json({ error: 'missing_action' }, 400);
  }

  const decoded = parseButtonValue(action.value);
  if (!decoded) {
    log.warn('slack.bad_button_value', { requestId });
    return c.json({ error: 'bad_button_value' }, 400);
  }

  const actor =
    payload.user?.name ??
    payload.user?.username ??
    payload.user?.id ??
    'unknown';

  // Look up the approval BEFORE deciding so the Slack message update
  // can reflect the correct final state — including the "already
  // decided" no-op branch.
  const approvalBefore = await approvalsRepo.findById(decoded.approvalId);
  if (!approvalBefore) {
    if (payload.channel?.id && payload.user?.id) {
      await postEphemeral(
        payload.channel.id,
        payload.user.id,
        `:warning: Approval \`${decoded.approvalId}\` no longer exists.`,
      );
    }
    return c.json({ ok: false, reason: 'not_found' }, 404);
  }

  const result = await decideApproval(decoded.approvalId, decoded.decision, {
    source: 'slack',
    approverAddress: null,
    approvalTxnId: null,
    requestId,
  });

  const messageContext: ApprovalNotificationInput = {
    approvalId: approvalBefore.id,
    agentName: approvalBefore.transaction.agent.name,
    agentAddress: approvalBefore.transaction.agent.algoAddress,
    route: approvalBefore.transaction.route,
    amountUsdc: Number(approvalBefore.transaction.amountMicroUsdc) / 1_000_000,
    riskScore: approvalBefore.transaction.riskScore,
    riskReason: approvalBefore.transaction.riskReason,
    expiresAt: approvalBefore.expiresAt,
  };

  // Choose which channel + ts to update: prefer the ones on the payload
  // (from the message the user clicked), fall back to what we stored
  // when we originally posted.
  const channelId = payload.channel?.id ?? approvalBefore.slackChannelId;
  const messageTs = payload.message?.ts ?? approvalBefore.slackMessageTs;

  if (result.status === 'noop') {
    // Someone else (dashboard, or another Slack click) already decided.
    if (channelId && payload.user?.id) {
      const priorStatus = result.approval?.status ?? 'decided';
      await postEphemeral(
        channelId,
        payload.user.id,
        result.reason === 'expired'
          ? `:hourglass_flowing_sand: That approval already expired.`
          : `:information_source: That approval was already *${priorStatus}*.`,
      );
      // Also update the stale message so the buttons don't linger.
      if (messageTs && result.approval?.status && result.approval.status !== 'pending') {
        await updateApprovalMessage(
          channelId,
          messageTs,
          messageContext,
          result.approval.status === 'approved' ? 'approved' : 'denied',
          result.approval.approverAddress ?? 'previous approver',
        );
      }
    }
    return c.json({ ok: false, reason: result.reason });
  }

  // Real state transition — update the Slack message so buttons are gone.
  if (channelId && messageTs) {
    await updateApprovalMessage(
      channelId,
      messageTs,
      messageContext,
      decoded.decision,
      `@${actor} (via Slack)`,
    );
  }

  return c.json({ ok: true, status: result.approval.status });
});

/**
 * Slack sends `application/x-www-form-urlencoded` with a single
 * `payload=<url-encoded JSON>` field. We keep the raw body around for
 * signature verification and then extract the JSON.
 */
function parseFormPayload(rawBody: string): { payload: SlackInteractivePayload } | null {
  const params = new URLSearchParams(rawBody);
  const raw = params.get('payload');
  if (!raw) return null;
  try {
    return { payload: JSON.parse(raw) as SlackInteractivePayload };
  } catch {
    return null;
  }
}

// Minimal type shape — we only touch these fields.
interface SlackInteractivePayload {
  type?: string;
  user?: { id?: string; name?: string; username?: string };
  channel?: { id?: string; name?: string };
  message?: { ts?: string };
  actions?: Array<{ action_id?: string; value?: string }>;
}
