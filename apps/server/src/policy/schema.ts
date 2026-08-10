/**
 * Policy schema — the exact JSON shape mirrored by the on-chain
 * policy contract's box storage. Anything valid here can be pushed
 * to Algorand as-is; anything on-chain deserializes back into this.
 *
 * All amounts are in **micro-USDC** (1 USDC = 1_000_000 micro).
 */
import { z } from 'zod';

export const RouteSchema = z
  .string()
  .regex(/^(GET|POST|PUT|DELETE|PATCH) \/[a-zA-Z0-9/_\-:.]*$/, {
    message: "Route must be like 'POST /llm/summarize'",
  });

export const PolicySchema = z.object({
  agentAddress: z.string().length(58, 'Algorand address must be 58 chars'),
  dailyCapMicroUsdc: z.number().int().nonnegative(),
  monthlyCapMicroUsdc: z.number().int().nonnegative(),
  humanThresholdMicroUsdc: z.number().int().nonnegative(),
  allowedRoutes: z.array(RouteSchema).min(1),
  riskThreshold: z.number().int().min(0).max(100).default(70),
  frozen: z.boolean().default(false),
});

export type Policy = z.infer<typeof PolicySchema>;

export const PolicyUpdatePreviewSchema = z.object({
  before: PolicySchema.nullable(),
  after: PolicySchema,
  changes: z.array(
    z.object({
      field: z.string(),
      from: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
      to: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
    })
  ),
});

export type PolicyUpdatePreview = z.infer<typeof PolicyUpdatePreviewSchema>;

/**
 * Rolling spend window kept off-chain in `transactions` and cached
 * in-process for speed. Not part of the on-chain box.
 */
export interface SpendWindow {
  dailySpentMicroUsdc: number;
  monthlySpentMicroUsdc: number;
  lastRefreshedAt: Date;
}

export interface EvaluationInput {
  policy: Policy;
  route: string;
  amountMicroUsdc: number;
  spend: SpendWindow;
  riskScore?: number;
  riskReason?: string;
}

export type EvaluationVerdict =
  | { action: 'allow'; reason: null }
  | { action: 'block'; code: 'FROZEN' | 'ROUTE_DISALLOWED' | 'DAILY_CAP' | 'MONTHLY_CAP' | 'RISK'; reason: string }
  | { action: 'escalate'; code: 'HUMAN_THRESHOLD' | 'RISK_ESCALATION'; reason: string };

/**
 * Human-readable ruleset — every rule the engine considered, whether or
 * not it fired. Used by the dashboard "Policy Evaluation" viz and by
 * MCP clients that need to understand WHY a request was allowed / blocked
 * / escalated. `matched` = true means this rule contributed to the
 * decision; the FIRST matched rule (by precedence) is the primary one.
 */
export type RuleId =
  | 'agent_frozen'
  | 'route_allowlist'
  | 'daily_cap'
  | 'monthly_cap'
  | 'risk_critical'
  | 'human_threshold'
  | 'risk_escalation'
  | 'daily_warning';

export type RuleSeverity = 'info' | 'warn' | 'escalate' | 'block';

export interface RuleTrace {
  id: RuleId;
  label: string;
  matched: boolean;
  severity: RuleSeverity;
  detail: string;
}

export interface SpendingState {
  dailySpentMicroUsdc: number;
  dailyCapMicroUsdc: number;
  monthlySpentMicroUsdc: number;
  monthlyCapMicroUsdc: number;
  remainingDailyMicroUsdc: number;
  remainingMonthlyMicroUsdc: number;
  amountMicroUsdc: number;
  projectedDailyUtilPct: number;   // (spent + amount) / cap * 100
}

/**
 * Verbose evaluation used by the /simulate endpoint + MCP + dashboard.
 * `decision` mirrors `action` in UPPERCASE for external stability.
 */
export interface EvaluationTrace {
  decision: 'ALLOW' | 'BLOCK' | 'ESCALATE';
  primaryCode:
    | 'ALLOW'
    | 'FROZEN'
    | 'ROUTE_DISALLOWED'
    | 'DAILY_CAP'
    | 'MONTHLY_CAP'
    | 'RISK'
    | 'HUMAN_THRESHOLD'
    | 'RISK_ESCALATION';
  reason: string | null;
  routeAllowed: boolean;
  riskScore: number | null;
  riskThreshold: number;
  spendingState: SpendingState;
  rules: RuleTrace[];
}
