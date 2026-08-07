/**
 * Natural-language → structured policy parser.
 *
 * Owner types a sentence like:
 *   "Cap this agent at $2/day, no /gpu/render, approval above $0.10"
 * We ask Claude Haiku to emit a strict JSON policy patch, then validate
 * against PolicySchema. Never auto-applied — the dashboard shows a diff
 * and the owner signs the on-chain update from Pera.
 */
import Anthropic from '@anthropic-ai/sdk';
import { PolicySchema, type Policy } from './schema';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' });

const SYSTEM = `You convert a plain-English spending policy for an autonomous AI agent
into strict JSON. Follow these rules:

- All money is USDC. Convert dollars to MICRO-USDC (1 USDC = 1_000_000 micro).
- If the user does not specify a value, KEEP the current value from the "current" policy.
- Route names look like "POST /llm/summarize" or "POST /gpu/render". Only ever include
  routes from the "availableRoutes" list.
- Return ONLY valid JSON matching this exact TypeScript type — no prose, no markdown fences:

{
  "agentAddress": string,
  "dailyCapMicroUsdc": number,
  "monthlyCapMicroUsdc": number,
  "humanThresholdMicroUsdc": number,
  "allowedRoutes": string[],
  "riskThreshold": number,   // 0..100, default 70
  "frozen": boolean
}

If you cannot understand the request, return the current policy unchanged.`;

export interface ParseArgs {
  current: Policy;
  availableRoutes: string[];
  prompt: string;
}

export async function parsePolicy(args: ParseArgs): Promise<Policy> {
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `current = ${JSON.stringify(args.current, null, 2)}
availableRoutes = ${JSON.stringify(args.availableRoutes)}

Instruction: ${args.prompt}

Return the updated policy as JSON only.`,
      },
    ],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(stripped);
  return PolicySchema.parse(parsed);
}

export function diffPolicies(before: Policy | null, after: Policy) {
  const fields: (keyof Policy)[] = [
    'dailyCapMicroUsdc',
    'monthlyCapMicroUsdc',
    'humanThresholdMicroUsdc',
    'allowedRoutes',
    'riskThreshold',
    'frozen',
  ];
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  for (const f of fields) {
    const from = before ? before[f] : null;
    const to = after[f];
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes.push({ field: f, from: from as never, to: to as never });
    }
  }
  return changes;
}
