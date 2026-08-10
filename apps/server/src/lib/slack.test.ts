/**
 * Pure unit tests for the Slack lib.
 *
 * No live Slack call is made — signature verification is deterministic,
 * and Block Kit builders are pure. HTTP-touching helpers are tested via
 * the wider slack-actions integration test.
 */
import { after, before, describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import crypto from 'node:crypto';

import {
  buildApprovalBlocks,
  buildDecidedBlocks,
  parseButtonValue,
  verifySlackSignature,
  isSlackEnabled,
  type ApprovalNotificationInput,
} from './slack';

const SECRET = 'unit-test-signing-secret';

function makeSig(secret: string, ts: number, body: string): string {
  const base = `v0:${ts}:${body}`;
  return 'v0=' + crypto.createHmac('sha256', secret).update(base).digest('hex');
}

const SAMPLE_INPUT: ApprovalNotificationInput = {
  approvalId: 'e0b47c11-9a0f-4a02-91d0-5cf7f5c4b8f1',
  agentName: 'Pera main',
  agentAddress: 'IUHZA64HKSAEUPAOCPXZ5WCAJU6HHYUZY4MQHHEEEWSKGYFP6ACBKIOEFQ',
  route: 'POST /gpu/render',
  amountUsdc: 0.5,
  riskScore: 12,
  riskReason: 'Amount 0.50 USDC is above human-approval threshold 0.05.',
  expiresAt: new Date('2026-08-08T12:34:56Z'),
};

describe('slack.verifySlackSignature', () => {
  test('accepts a valid signature within the replay window', () => {
    const ts = Math.floor(Date.now() / 1000);
    const body = 'payload=%7B%22ok%22%3Atrue%7D';
    const sig = makeSig(SECRET, ts, body);
    const r = verifySlackSignature(body, String(ts), sig, SECRET);
    assert.equal(r.ok, true);
  });

  test('rejects a wrong signature', () => {
    const ts = Math.floor(Date.now() / 1000);
    const body = 'payload=1';
    const sig = makeSig('OTHER SECRET', ts, body);
    const r = verifySlackSignature(body, String(ts), sig, SECRET);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'bad_signature');
  });

  test('rejects a stale timestamp (replay)', () => {
    const ts = Math.floor(Date.now() / 1000) - 60 * 60; // 1 hour old
    const body = 'payload=1';
    const sig = makeSig(SECRET, ts, body);
    const r = verifySlackSignature(body, String(ts), sig, SECRET);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'replay_window');
  });

  test('rejects when headers are missing', () => {
    const r = verifySlackSignature('body', null, null, SECRET);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'missing_headers');
  });

  test('does not throw on garbage signature strings', () => {
    const ts = Math.floor(Date.now() / 1000);
    const r = verifySlackSignature('body', String(ts), 'not-a-signature', SECRET);
    assert.equal(r.ok, false);
  });
});

describe('slack.parseButtonValue', () => {
  test('parses a valid approve button', () => {
    assert.deepEqual(parseButtonValue('approval:abc123:approved'), {
      approvalId: 'abc123',
      decision: 'approved',
    });
  });
  test('parses a valid deny button', () => {
    assert.deepEqual(parseButtonValue('approval:abc123:denied'), {
      approvalId: 'abc123',
      decision: 'denied',
    });
  });
  test('rejects unknown prefix', () => {
    assert.equal(parseButtonValue('other:abc:approved'), null);
  });
  test('rejects unknown decision', () => {
    assert.equal(parseButtonValue('approval:abc:refund'), null);
  });
  test('rejects missing id', () => {
    assert.equal(parseButtonValue('approval::approved'), null);
  });
});

describe('slack.buildApprovalBlocks', () => {
  test('produces exactly one actions block with two buttons', () => {
    const blocks = buildApprovalBlocks(SAMPLE_INPUT);
    const actions = blocks.find((b: any) => b.type === 'actions') as any;
    assert.ok(actions, 'has an actions block');
    assert.equal(actions.elements.length, 2);
    assert.equal(actions.elements[0].action_id, 'approve');
    assert.equal(actions.elements[1].action_id, 'deny');
  });

  test('button values ONLY carry approval:id:decision — never PII/secrets', () => {
    const blocks = buildApprovalBlocks(SAMPLE_INPUT);
    const actions = blocks.find((b: any) => b.type === 'actions') as any;
    for (const el of actions.elements) {
      assert.match(el.value, /^approval:[a-z0-9-]+:(approved|denied)$/);
    }
  });

  test('decided blocks have no actions row', () => {
    const decided = buildDecidedBlocks(SAMPLE_INPUT, 'approved', 'alice');
    assert.equal(decided.find((b: any) => b.type === 'actions'), undefined);
  });
});

describe('slack.isSlackEnabled', () => {
  const orig = {
    BOT: process.env.SLACK_BOT_TOKEN,
    SIG: process.env.SLACK_SIGNING_SECRET,
    CH: process.env.SLACK_APPROVAL_CHANNEL_ID,
  };
  before(() => {
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_SIGNING_SECRET;
    delete process.env.SLACK_APPROVAL_CHANNEL_ID;
  });
  after(() => {
    if (orig.BOT) process.env.SLACK_BOT_TOKEN = orig.BOT;
    if (orig.SIG) process.env.SLACK_SIGNING_SECRET = orig.SIG;
    if (orig.CH) process.env.SLACK_APPROVAL_CHANNEL_ID = orig.CH;
  });
  test('false when any variable is missing', () => {
    assert.equal(isSlackEnabled(), false);
  });
  test('true only when all three are set', () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    process.env.SLACK_SIGNING_SECRET = 'sig';
    process.env.SLACK_APPROVAL_CHANNEL_ID = 'C123';
    assert.equal(isSlackEnabled(), true);
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_SIGNING_SECRET;
    delete process.env.SLACK_APPROVAL_CHANNEL_ID;
  });
});
