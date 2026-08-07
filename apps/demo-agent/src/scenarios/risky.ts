/**
 * Scenario: runaway agent — 20 rapid-fire /llm/summarize calls. The
 * AI risk service catches the burst pattern and starts escalating /
 * blocking. The daily cap also trips somewhere in the middle. Judges
 * see the dashboard's live feed light up red.
 */
import type { makeClient } from '../client.js';

const NOISE = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod ';

export async function run(client: ReturnType<typeof makeClient>) {
  console.log('\n▶ scenario: runaway loop — 20× POST /llm/summarize\n');

  for (let i = 0; i < 20; i++) {
    const jitter = NOISE.repeat(3) + `#${i}`;
    try {
      const res = await client.call('/llm/summarize', {
        method: 'POST',
        body: JSON.stringify({ text: jitter, style: 'tldr' }),
      });
      const line =
        res.status === 200
          ? `#${i.toString().padStart(2)} 200 paid (${(res as any).paymentTxId?.slice(0, 12) ?? 'ok'}…)`
          : res.status === 402
            ? `#${i.toString().padStart(2)} 402 escalated  ${res.reason ?? ''}`
            : `#${i.toString().padStart(2)} ${res.status}  ${(res.body as any)?.reason ?? (res.body as any)?.error ?? ''}`;
      console.log('  ' + line);
    } catch (err: any) {
      console.log(`  #${i} ERROR ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}
