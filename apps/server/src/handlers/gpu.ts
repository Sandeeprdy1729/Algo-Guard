/**
 * POST /gpu/render  —  $0.50 USDC.
 *
 * Simulated GPU render. We do NOT actually spin up GPUs — the demo
 * value is the *escalation* path (policyMiddleware forces human
 * approval before x402 ever quotes a price). This handler only runs
 * once approval is granted and payment settles.
 */
import type { Context } from 'hono';
import crypto from 'node:crypto';

interface Body {
  prompt?: string;
  steps?: number;
}

export async function handleGpuRender(c: Context) {
  const body = (await c.req.json().catch(() => ({}))) as Body;
  if (!body.prompt || body.prompt.trim().length < 3) {
    return c.json({ error: 'prompt field required' }, 400);
  }
  const steps = Math.min(50, Math.max(1, body.steps ?? 20));
  const renderId = 'r_' + crypto.randomBytes(6).toString('hex');
  const gpuSeconds = +(steps * 0.42).toFixed(2);

  // Deterministic placeholder image — real product would enqueue a job.
  const seed = crypto.createHash('sha1').update(body.prompt).digest('hex').slice(0, 8);
  const imageUrl = `https://picsum.photos/seed/${seed}/1024/1024`;

  return c.json({
    renderId,
    prompt: body.prompt,
    steps,
    gpuSeconds,
    imageUrl,
    paidVia: 'x402 / USDC Algorand Testnet / governed by AgentGuard',
  });
}
