/**
 * Rolling spend window per agent. Off-chain view; the chain is the
 * ultimate enforcer, but we compute this so the policy engine can
 * pre-flight reject and save the agent a signature.
 *
 * Cached in-process; invalidated on freeze/unfreeze/policy commit/decision.
 */
import { LRUCache } from 'lru-cache';
import { transactionsRepo } from '../repos';
import type { SpendWindow } from './schema';

const cache = new LRUCache<string, SpendWindow>({ max: 500, ttl: 15_000 });

export async function getSpendWindow(agentId: string): Promise<SpendWindow> {
  const hit = cache.get(agentId);
  if (hit) return hit;

  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const { dailyMicro, monthlyMicro } = await transactionsRepo.spendWindow(
    agentId,
    dayStart,
    monthStart
  );
  const window: SpendWindow = {
    dailySpentMicroUsdc: dailyMicro,
    monthlySpentMicroUsdc: monthlyMicro,
    lastRefreshedAt: now,
  };
  cache.set(agentId, window);
  return window;
}

export function invalidateSpendWindow(agentId: string) {
  cache.delete(agentId);
}
