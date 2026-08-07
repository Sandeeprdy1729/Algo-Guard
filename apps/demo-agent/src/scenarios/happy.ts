/**
 * Scenario: happy path — one summarize call, allowed by policy, paid,
 * returned. Judges see: 402 → sign → settle → 200 in ~3s.
 */
import type { makeClient } from '../client.js';

const SAMPLE = `Autonomous AI agents are now capable of discovering APIs, calling
paid endpoints, and completing workflows without human intervention. The bottleneck
is trust: enterprises will not deploy agents that can spend real money until they
have a way to bound and audit that spend. AgentGuard puts the policy on Algorand
so the payment layer itself refuses violations.`;

export async function run(client: ReturnType<typeof makeClient>) {
  console.log('\n▶ scenario: happy path — POST /llm/summarize $0.01\n');
  const res = await client.call('/llm/summarize', {
    method: 'POST',
    body: JSON.stringify({ text: SAMPLE, style: 'tldr' }),
  });
  console.log(`  status = ${res.status}`);
  if (res.paymentTxId) console.log(`  paid via ${res.paymentTxId}`);
  console.log('  body   =', JSON.stringify(res.body, null, 2));
}
