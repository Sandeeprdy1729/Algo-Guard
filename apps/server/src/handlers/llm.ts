/**
 * POST /llm/summarize  —  $0.01 USDC.
 *
 * Reached only after policyMiddleware allows AND paymentMiddleware
 * verified + settled the x402 payment. Runs a real Groq call so the
 * paid resource is genuinely non-trivial. When GROQ_API_KEY is unset
 * we fall back to a local extractive summariser so the demo still
 * works offline.
 */
import type { Context } from 'hono';
import Groq from 'groq-sdk';

const MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';
let _groq: Groq | null | undefined;

function getGroq(): Groq | null {
  if (_groq !== undefined) return _groq;
  const apiKey = process.env.GROQ_API_KEY;
  _groq = apiKey ? new Groq({ apiKey }) : null;
  return _groq;
}

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
  const groq = getGroq();

  if (!groq) {
    return c.json({
      summary: cheapFallback(body.text, style),
      model: 'local-fallback',
      tokens: body.text.length,
      paidVia: 'x402 / USDC Algorand Testnet / governed by AgentGuard',
    });
  }

  const completion = await groq.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    max_tokens: 400,
    messages: [
      {
        role: 'system',
        content: `You summarise text. ${STYLE_PROMPT[style]} Do not preface with "Summary:" or similar.`,
      },
      { role: 'user', content: body.text },
    ],
  });

  const summary = completion.choices[0]?.message?.content?.trim() ?? '';
  const usage = completion.usage;
  return c.json({
    summary,
    model: completion.model,
    tokens: (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0),
    paidVia: 'x402 / USDC Algorand Testnet / governed by AgentGuard',
  });
}

function cheapFallback(text: string, style: 'bullet' | 'tldr' | 'exec'): string {
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).slice(0, 5);
  if (style === 'bullet') return sentences.map((s) => `• ${s}`).join('\n');
  if (style === 'tldr') return sentences[0] ?? text.slice(0, 200);
  return sentences.join(' ');
}
