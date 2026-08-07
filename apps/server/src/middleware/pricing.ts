/**
 * Single source of truth for route pricing.
 *
 * Kept separate from endpoints.config.ts so the policy middleware
 * can consult prices without pulling in x402 types. The two files
 * MUST agree — a change here without a change there means the
 * middleware would evaluate a wrong amount.
 *
 * Amounts in micro-USDC (6 decimals).
 */
const PRICES: Record<string, number> = {
  'POST /llm/summarize': 10_000,   // $0.01
  'POST /gpu/render': 500_000,     // $0.50
};

export function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

export function priceForRoute(route: string): number | null {
  return PRICES[route] ?? null;
}

export function allProtectedRoutes(): string[] {
  return Object.keys(PRICES);
}
