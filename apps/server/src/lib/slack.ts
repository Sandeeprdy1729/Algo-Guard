/**
 * Thin, dependency-free Slack Web-API client for approval notifications.
 *
 * - Uses `fetch` — no @slack/web-api package needed.
 * - Enabled only when SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, and
 *   SLACK_APPROVAL_CHANNEL_ID are all set. Otherwise every function
 *   becomes a no-op so Slack failure never breaks the approval flow.
 * - Signature verification follows Slack's official spec:
 *     v0={timestamp}:{rawBody} → HMAC-SHA256 with signing secret → hex
 *     compared to X-Slack-Signature using timing-safe equality.
 * - Replay protection: reject requests whose X-Slack-Request-Timestamp
 *   is more than 5 minutes off from server clock.
 */
import crypto from 'node:crypto';
import { log } from './logger';

const SLACK_API = 'https://slack.com/api';
const REPLAY_WINDOW_SECONDS = 60 * 5;

// ── Configuration ────────────────────────────────────────────────────

export interface SlackConfig {
  botToken: string;
  signingSecret: string;
  channelId: string;
}

export function getSlackConfig(): SlackConfig | null {
  const botToken     = process.env.SLACK_BOT_TOKEN?.trim();
  const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim();
  const channelId    = process.env.SLACK_APPROVAL_CHANNEL_ID?.trim();
  if (!botToken || !signingSecret || !channelId) return null;
  return { botToken, signingSecret, channelId };
}

export function isSlackEnabled(): boolean {
  return getSlackConfig() !== null;
}

// ── Signature verification ──────────────────────────────────────────

export interface SignatureCheck {
  ok: boolean;
  reason?: 'missing_headers' | 'replay_window' | 'bad_signature' | 'not_configured';
}

export function verifySlackSignature(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  signingSecret?: string,
): SignatureCheck {
  const secret = signingSecret ?? getSlackConfig()?.signingSecret;
  if (!secret) return { ok: false, reason: 'not_configured' };
  if (!timestampHeader || !signatureHeader) {
    return { ok: false, reason: 'missing_headers' };
  }
  const ts = parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'missing_headers' };
  const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (skew > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: 'replay_window' };
  }
  const base = `v0:${ts}:${rawBody}`;
  const mac = 'v0=' + crypto.createHmac('sha256', secret).update(base).digest('hex');
  try {
    const a = Buffer.from(mac);
    const b = Buffer.from(signatureHeader);
    if (a.length !== b.length) return { ok: false, reason: 'bad_signature' };
    if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
}

// ── Block Kit builders ─────────────────────────────────────────────

export interface ApprovalNotificationInput {
  approvalId: string;
  agentName: string;
  agentAddress: string;
  route: string;
  amountUsdc: number;
  riskScore: number | null;
  riskReason: string | null;
  expiresAt: Date;
}

/**
 * Button value carries ONLY the approval id + decision keyword.
 * No wallet, no secret, no PII. Ownership is re-verified server-side.
 */
export function buildApprovalBlocks(input: ApprovalNotificationInput) {
  const amount = `$${input.amountUsdc.toFixed(input.amountUsdc < 0.01 ? 4 : 2)}`;
  const expires = input.expiresAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const riskLine =
    input.riskScore != null
      ? `*Risk score:* ${input.riskScore}${input.riskReason ? ` — ${input.riskReason}` : ''}`
      : input.riskReason
        ? `*Signal:* ${input.riskReason}`
        : '_No risk signal captured_';

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: ':rotating_light: Human approval required' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Agent*\n${escapeMd(input.agentName)}` },
        { type: 'mrkdwn', text: `*Amount*\n${amount} USDC` },
        { type: 'mrkdwn', text: `*Route*\n\`${escapeMd(input.route)}\`` },
        { type: 'mrkdwn', text: `*Wallet*\n\`${escapeMd(shortAddress(input.agentAddress))}\`` },
      ],
    },
    { type: 'section', text: { type: 'mrkdwn', text: riskLine } },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Approval id \`${input.approvalId}\`  ·  expires ${expires}`,
        },
      ],
    },
    {
      type: 'actions',
      block_id: 'agentguard_actions',
      elements: [
        {
          type: 'button',
          action_id: 'approve',
          style: 'primary',
          text: { type: 'plain_text', text: 'Approve' },
          value: `approval:${input.approvalId}:approved`,
          confirm: {
            title: { type: 'plain_text', text: 'Approve this payment?' },
            text: { type: 'mrkdwn', text: `Release ${amount} USDC for _${escapeMd(input.agentName)}_.` },
            confirm: { type: 'plain_text', text: 'Approve' },
            deny: { type: 'plain_text', text: 'Cancel' },
          },
        },
        {
          type: 'button',
          action_id: 'deny',
          style: 'danger',
          text: { type: 'plain_text', text: 'Deny' },
          value: `approval:${input.approvalId}:denied`,
        },
      ],
    },
  ];
}

/**
 * Blocks used AFTER a decision — button row removed, status stamped.
 */
export function buildDecidedBlocks(
  original: ApprovalNotificationInput,
  decision: 'approved' | 'denied',
  actor: string,
) {
  const label = decision === 'approved' ? ':white_check_mark: APPROVED' : ':x: DENIED';
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: label },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Agent*\n${escapeMd(original.agentName)}` },
        { type: 'mrkdwn', text: `*Amount*\n$${original.amountUsdc.toFixed(original.amountUsdc < 0.01 ? 4 : 2)} USDC` },
        { type: 'mrkdwn', text: `*Route*\n\`${escapeMd(original.route)}\`` },
        { type: 'mrkdwn', text: `*Decided by*\n${escapeMd(actor)}` },
      ],
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `Approval id \`${original.approvalId}\`` },
      ],
    },
  ];
}

// ── Web-API calls ──────────────────────────────────────────────────

export interface SlackPostResult {
  ok: boolean;
  channel?: string;
  ts?: string;
  error?: string;
}

export async function postApprovalMessage(
  input: ApprovalNotificationInput,
): Promise<SlackPostResult | null> {
  const cfg = getSlackConfig();
  if (!cfg) return null;
  const blocks = buildApprovalBlocks(input);
  const body = {
    channel: cfg.channelId,
    text: `AgentGuard: human approval required for ${input.agentName} · $${input.amountUsdc.toFixed(2)} USDC`,
    blocks,
  };
  try {
    const res = await slackFetch(cfg.botToken, 'chat.postMessage', body);
    if (!res.ok) {
      log.warn('slack.post.failed', { approvalId: input.approvalId, error: res.error });
      return { ok: false, error: res.error };
    }
    return { ok: true, channel: res.channel, ts: res.ts };
  } catch (err) {
    log.warn('slack.post.exception', {
      approvalId: input.approvalId,
      msg: (err as Error).message,
    });
    return { ok: false, error: (err as Error).message };
  }
}

export async function updateApprovalMessage(
  channel: string,
  ts: string,
  original: ApprovalNotificationInput,
  decision: 'approved' | 'denied',
  actor: string,
): Promise<SlackPostResult | null> {
  const cfg = getSlackConfig();
  if (!cfg) return null;
  const blocks = buildDecidedBlocks(original, decision, actor);
  const body = {
    channel,
    ts,
    text: `AgentGuard: ${decision.toUpperCase()} — ${original.agentName} · $${original.amountUsdc.toFixed(2)} USDC`,
    blocks,
  };
  try {
    const res = await slackFetch(cfg.botToken, 'chat.update', body);
    if (!res.ok) {
      log.warn('slack.update.failed', {
        approvalId: original.approvalId,
        error: res.error,
      });
      return { ok: false, error: res.error };
    }
    return { ok: true, channel: res.channel, ts: res.ts };
  } catch (err) {
    log.warn('slack.update.exception', {
      approvalId: original.approvalId,
      msg: (err as Error).message,
    });
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Post a short ephemeral response back to the acting user — used when
 * an action was a no-op (already decided / expired).
 */
export async function postEphemeral(
  channel: string,
  userId: string,
  text: string,
): Promise<void> {
  const cfg = getSlackConfig();
  if (!cfg) return;
  try {
    await slackFetch(cfg.botToken, 'chat.postEphemeral', { channel, user: userId, text });
  } catch (err) {
    log.warn('slack.ephemeral.exception', { msg: (err as Error).message });
  }
}

// ── Internals ──────────────────────────────────────────────────────

async function slackFetch(
  botToken: string,
  method: string,
  body: unknown,
): Promise<Record<string, any> & { ok: boolean; error?: string }> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({ ok: false, error: 'invalid_json' }))) as any;
  return json;
}

function escapeMd(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));
}

function shortAddress(a: string): string {
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/**
 * Parse the "approval:<id>:<decision>" button value into pieces.
 * Returns null on any malformed input.
 */
export function parseButtonValue(
  value: string,
): { approvalId: string; decision: 'approved' | 'denied' } | null {
  const [kind, id, decision] = value.split(':');
  if (kind !== 'approval') return null;
  if (!id || (decision !== 'approved' && decision !== 'denied')) return null;
  return { approvalId: id, decision };
}
