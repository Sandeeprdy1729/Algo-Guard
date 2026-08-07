/**
 * POST /llm/summarize  —  $0.01 USDC.
 *
 * Reached only after policyMiddleware allows AND paymentMiddleware
 * has verified + settled the x402 payment. Runs a real Claude call so
 * the paid resource is genuinely non-trivial.
 */
import type { Context } from 'hono';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' });

interface Body {
  text?: string;
  style?: 'bullet' | 'tldr' | 'exec';
}

const STYLE_PROMPT: Record<Required<Body>['style'], string> = {
  bullet: 'Return exactly five concise bullet points.',
  tldr: 'Return one single sentence, no more than 30 words.',
  exec: 'Return a two-paragraph executive summary.',
};

export async function handleLlmSummarize(c: Context) {
  const body = (await c.req.json().catch(() => ({}))) as Body;
  if (!body.text || body.text.trim().length < 20) {
    return c.json({ error: 'text field required, min 20 chars' }, 400);
  }
  const style = body.style ?? 'tldr';

  // Fallback when no key is configured so the demo still works.
  if (!process.env.ANTHROPIC_API_KEY) {
    return c.json({
      summary: cheapFallback(body.text, style),
      model: 'local-fallback',
      tokens: body.text.length,
      paidVia: 'x402 / USDC Algorand Testnet / governed by AgentGuard',
    });
  }

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: `You summarise text. ${STYLE_PROMPT[style]} Do not preface with "Summary:" or similar.`,
    messages: [{ role: 'user', content: body.text }],
  });
  const summary = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  return c.json({
    summary,
    model: msg.model,
    tokens: msg.usage.input_tokens + msg.usage.output_tokens,
    paidVia: 'x402 / USDC Algorand Testnet / governed by AgentGuard',
  });
}

function cheapFallback(text: string, style: 'bullet' | 'tldr' | 'exec'): string {
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).slice(0, 5);
  if (style === 'bullet') return sentences.map((s) => `• ${s}`).join('\n');
  if (style === 'tldr') return sentences[0] ?? text.slice(0, 200);
  return sentences.join(' ');
}
