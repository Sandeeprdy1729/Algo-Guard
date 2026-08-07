/**
 * Natural-language → structured policy parser (Groq).
 *
 * Owner types a sentence like:
 *   "Cap this agent at $2/day, no /gpu/render, approval above $0.10"
 * We ask Groq (JSON mode) to emit a strict JSON policy patch, then
 * validate against PolicySchema. Never auto-applied — the dashboard
 * shows a diff and the owner signs the on-chain update from Pera.
 *
 * If GROQ_API_KEY is unset this call throws; the API route surfaces
 * that to the frontend as a normal ApiError (the parser isn't a hot
 * path so a hard failure is fine — nothing to fall back to for text
 * comprehension).
 */
import Groq from 'groq-sdk';
import { PolicySchema, type Policy } from './schema';

const MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';
let _groq: Groq | null | undefined;

function getGroq(): Groq {
  if (_groq) return _groq;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY missing — cannot parse natural-language policies');
  _groq = new Groq({ apiKey });
  return _groq;
}

const SYSTEM = `You convert a plain-English spending policy for an autonomous AI agent
into strict JSON.

CRITICAL — dollars to micro-USDC conversion:
- 1 USDC = 1,000,000 micro-USDC.
- MULTIPLY every dollar amount by 1,000,000 to get micro-USDC.
- Examples:
    "$0.01"  → 10000
    "$0.05"  → 50000
    "$0.10"  → 100000
    "$1"     → 1000000
    "$2"     → 2000000
    "$10"    → 10000000

Other rules:
- If the user does not specify a value, KEEP the current value from "current".
- Route names look like "POST /llm/summarize" or "POST /gpu/render". Only include
  routes from "availableRoutes".
- Return ONLY valid JSON matching this exact TypeScript type — no prose, no fences:

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
  const groq = getGroq();
  const completion = await groq.chat.completions.create({
    model: MODEL,
    temperature: 0,
    max_tokens: 800,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `current = ${JSON.stringify(args.current, null, 2)}
availableRoutes = ${JSON.stringify(args.availableRoutes)}

Instruction: ${args.prompt}

Return the updated policy as JSON only.`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? '';
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
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
