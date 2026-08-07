/**
 * Scenario: escalation — /gpu/render is above the human threshold.
 *
 * 1. Agent calls /gpu/render → server returns 402 with escalationIntentId.
 * 2. Agent polls the approval endpoint.
 * 3. Human (in the dashboard) approves. Server records decision, chain
 *    optionally receives the approve_intent tx.
 * 4. Agent retries and receives 200 with the render.
 */
import type { makeClient } from '../client.js';

export async function run(client: ReturnType<typeof makeClient>) {
  console.log('\n▶ scenario: escalation — POST /gpu/render $0.50\n');

  const first = await client.call('/gpu/render', {
    method: 'POST',
    body: JSON.stringify({ prompt: 'a cinematic still of a cyberpunk city at dusk', steps: 24 }),
  });

  if (!first.escalation) {
    console.log('  no escalation received (policy already allowed the call):', first.status);
    console.log('  body =', JSON.stringify(first.body, null, 2));
    return;
  }

  console.log(`  escalated: intent ${first.escalation.intentId}`);
  console.log(`  reason:    ${first.reason}`);
  console.log('  waiting for human approval… (approve from the dashboard now)\n');

  const decision = await client.waitForApproval(first.escalation.intentId, 180_000);
  console.log(`  decision = ${decision}`);

  if (decision !== 'approved') {
    console.log('  aborting.');
    return;
  }

  const second = await client.call('/gpu/render', {
    method: 'POST',
    body: JSON.stringify({ prompt: 'a cinematic still of a cyberpunk city at dusk', steps: 24 }),
  });
  console.log(`  retry status = ${second.status}`);
  if (second.paymentTxId) console.log(`  paid via ${second.paymentTxId}`);
  console.log('  body =', JSON.stringify(second.body, null, 2));
}
