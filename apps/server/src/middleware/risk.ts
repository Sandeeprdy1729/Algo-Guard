/**
 * Thin client for the AI risk service (FastAPI in apps/ai-service).
 *
 * Result cached in-process with LRU on (agent, route, amount_bucket)
 * for 60s. This is the *only* AI call in the request path.
 */
import { LRUCache } from 'lru-cache';

export interface RiskRequest {
  agentId: string;
  agentAddress: string;
  route: string;
  amountMicroUsdc: number;
}

export interface RiskResult {
  score: number;              // 0..100
  reason: string;
  action: 'allow' | 'escalate' | 'block';
}

const cache = new LRUCache<string, RiskResult>({ max: 1000, ttl: 60_000 });

const AI_URL = process.env.AI_SERVICE_URL ?? 'http://localhost:8000';

function bucket(microUsdc: number): string {
  // Bucket by log10 so $0.01 and $0.02 share a cache line but $0.01 and $0.50 do not.
  return Math.floor(Math.log10(Math.max(1, microUsdc))).toString();
}

export async function fetchRiskScore(req: RiskRequest): Promise<RiskResult> {
  const key = `${req.agentAddress}|${req.route}|${bucket(req.amountMicroUsdc)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 800); // hard budget

  try {
    const res = await fetch(`${AI_URL}/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`risk service ${res.status}`);
    const json = (await res.json()) as RiskResult;
    cache.set(key, json);
    return json;
  } finally {
    clearTimeout(t);
  }
}
