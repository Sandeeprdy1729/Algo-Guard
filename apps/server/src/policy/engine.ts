/**
 * Deterministic policy evaluator.
 *
 * `evaluate()` — the historical, minimal return shape used by
 *   `policyMiddleware`. Behaviour is UNCHANGED from v1; every existing
 *   test in engine.test.ts continues to pass.
 *
 * `trace()` — verbose evaluation used by the dashboard's Policy
 *   Evaluation viz + MCP + the /api/policies/simulate endpoint. Returns
 *   every rule the engine considered, whether or not it fired, plus
 *   spendingState so the UI can render progress bars without a second
 *   query.
 *
 * Both functions share the same rule set and the same precedence, so
 * `evaluate(x).action` and `trace(x).decision` always agree.
 *
 * Precedence (checked in order — first match wins):
 *
 *   1. FROZEN                   ← kill switch
 *   2. ROUTE_DISALLOWED         ← allowlist
 *   3. DAILY_CAP                ← hard spending limit
 *   4. MONTHLY_CAP              ← hard spending limit
 *   5. RISK ≥ 90 (critical)     ← hard block on obvious abuse
 *   6. HUMAN_THRESHOLD          ← escalation on amount
 *   7. RISK_ESCALATION          ← escalation on risk score
 *   8. ALLOW                    ← default
 *
 * The DAILY_WARNING rule (75 %+ util) is informational — it never
 * changes the decision but appears in the trace so the dashboard can
 * show an amber warning strip.
 */
import type {
  EvaluationInput,
  EvaluationTrace,
  EvaluationVerdict,
  RuleTrace,
  SpendingState,
} from './schema';

const CRITICAL_RISK = 90;
const DAILY_WARN_PCT = 75;

// ── Public: legacy verdict (unchanged) ─────────────────────────────

export function evaluate(input: EvaluationInput): EvaluationVerdict {
  const t = trace(input);
  switch (t.primaryCode) {
    case 'ALLOW':
      return { action: 'allow', reason: null };
    case 'FROZEN':
    case 'ROUTE_DISALLOWED':
    case 'DAILY_CAP':
    case 'MONTHLY_CAP':
    case 'RISK':
      return { action: 'block', code: t.primaryCode, reason: t.reason ?? '' };
    case 'HUMAN_THRESHOLD':
    case 'RISK_ESCALATION':
      return { action: 'escalate', code: t.primaryCode, reason: t.reason ?? '' };
  }
}

// ── Public: rich trace ─────────────────────────────────────────────

export function trace(input: EvaluationInput): EvaluationTrace {
  const { policy, route, amountMicroUsdc, spend, riskScore, riskReason } = input;

  const projectedDaily = spend.dailySpentMicroUsdc + amountMicroUsdc;
  const projectedMonthly = spend.monthlySpentMicroUsdc + amountMicroUsdc;
  const projectedDailyUtilPct = policy.dailyCapMicroUsdc > 0
    ? Math.min(100, (projectedDaily / policy.dailyCapMicroUsdc) * 100)
    : 0;

  const spendingState: SpendingState = {
    dailySpentMicroUsdc:       spend.dailySpentMicroUsdc,
    dailyCapMicroUsdc:         policy.dailyCapMicroUsdc,
    monthlySpentMicroUsdc:     spend.monthlySpentMicroUsdc,
    monthlyCapMicroUsdc:       policy.monthlyCapMicroUsdc,
    remainingDailyMicroUsdc:   Math.max(0, policy.dailyCapMicroUsdc - spend.dailySpentMicroUsdc),
    remainingMonthlyMicroUsdc: Math.max(0, policy.monthlyCapMicroUsdc - spend.monthlySpentMicroUsdc),
    amountMicroUsdc,
    projectedDailyUtilPct,
  };

  // Build every rule as an inert record; the first `matched && terminal`
  // one wins. `terminal` = block or escalate. Non-terminal matches (info
  // warnings) stay in the trace but don't change the decision.
  const rules: RuleTrace[] = [
    ruleFrozen(policy.frozen),
    ruleRouteAllowlist(route, policy.allowedRoutes),
    ruleDailyCap(spend.dailySpentMicroUsdc, amountMicroUsdc, policy.dailyCapMicroUsdc),
    ruleMonthlyCap(spend.monthlySpentMicroUsdc, amountMicroUsdc, policy.monthlyCapMicroUsdc),
    ruleCriticalRisk(riskScore, riskReason),
    ruleHumanThreshold(amountMicroUsdc, policy.humanThresholdMicroUsdc),
    ruleRiskEscalation(riskScore, policy.riskThreshold, riskReason),
    ruleDailyWarning(projectedDailyUtilPct),
  ];

  const decisive = rules.find((r) => r.matched && r.severity !== 'info');

  let decision: EvaluationTrace['decision'] = 'ALLOW';
  let primaryCode: EvaluationTrace['primaryCode'] = 'ALLOW';
  let reason: string | null = null;

  if (decisive) {
    if (decisive.severity === 'block') decision = 'BLOCK';
    else if (decisive.severity === 'escalate') decision = 'ESCALATE';
    primaryCode = ruleIdToCode(decisive.id);
    reason = decisive.detail;
  }

  return {
    decision,
    primaryCode,
    reason,
    routeAllowed: !ruleRouteAllowlist(route, policy.allowedRoutes).matched,
    riskScore: typeof riskScore === 'number' ? riskScore : null,
    riskThreshold: policy.riskThreshold,
    spendingState,
    rules,
  };
}

// ── Rule builders (pure — each returns a RuleTrace) ────────────────

function ruleFrozen(frozen: boolean): RuleTrace {
  return {
    id: 'agent_frozen',
    label: 'Agent is not frozen',
    matched: frozen,
    severity: 'block',
    detail: frozen
      ? 'Agent is frozen by policy admin — every request is refused.'
      : 'Agent is active.',
  };
}

function ruleRouteAllowlist(route: string, allowed: string[]): RuleTrace {
  const inList = allowed.includes(route);
  return {
    id: 'route_allowlist',
    label: 'Route is allow-listed',
    matched: !inList,
    severity: 'block',
    detail: inList
      ? `Route ${route} is allow-listed.`
      : `Route ${route} is NOT in the agent's allow-list (${allowed.length} allowed).`,
  };
}

function ruleDailyCap(spent: number, amount: number, cap: number): RuleTrace {
  const wouldExceed = spent + amount > cap;
  return {
    id: 'daily_cap',
    label: 'Daily budget available',
    matched: wouldExceed,
    severity: 'block',
    detail: wouldExceed
      ? `Daily cap ${fmt(cap)} USDC would be exceeded (already spent ${fmt(spent)}, request ${fmt(amount)}).`
      : `Daily spend ${fmt(spent)} + request ${fmt(amount)} ≤ ${fmt(cap)}.`,
  };
}

function ruleMonthlyCap(spent: number, amount: number, cap: number): RuleTrace {
  const wouldExceed = spent + amount > cap;
  return {
    id: 'monthly_cap',
    label: 'Monthly budget available',
    matched: wouldExceed,
    severity: 'block',
    detail: wouldExceed
      ? `Monthly cap ${fmt(cap)} USDC would be exceeded.`
      : `Monthly spend ${fmt(spent)} + request ${fmt(amount)} ≤ ${fmt(cap)}.`,
  };
}

function ruleCriticalRisk(riskScore: number | undefined, reason?: string): RuleTrace {
  const critical = typeof riskScore === 'number' && riskScore >= CRITICAL_RISK;
  return {
    id: 'risk_critical',
    label: `Risk score below critical (${CRITICAL_RISK})`,
    matched: critical,
    severity: 'block',
    detail: critical
      ? `Risk score ${riskScore} ≥ ${CRITICAL_RISK} (critical). ${reason ?? ''}`.trim()
      : typeof riskScore === 'number'
        ? `Risk score ${riskScore} below critical threshold.`
        : 'No risk score available.',
  };
}

function ruleHumanThreshold(amount: number, threshold: number): RuleTrace {
  const over = amount >= threshold;
  return {
    id: 'human_threshold',
    label: `Amount under human-approval threshold (${fmt(threshold)})`,
    matched: over,
    severity: 'escalate',
    detail: over
      ? `Amount ${fmt(amount)} USDC is above human-approval threshold ${fmt(threshold)}.`
      : `Amount ${fmt(amount)} USDC is below the human threshold ${fmt(threshold)}.`,
  };
}

function ruleRiskEscalation(
  riskScore: number | undefined,
  threshold: number,
  reason?: string,
): RuleTrace {
  const over = typeof riskScore === 'number' && riskScore >= threshold;
  return {
    id: 'risk_escalation',
    label: `Risk score below configured threshold (${threshold})`,
    matched: over,
    severity: 'escalate',
    detail: over
      ? `Risk score ${riskScore} is above configured threshold (${threshold}). ${reason ?? ''}`.trim()
      : typeof riskScore === 'number'
        ? `Risk score ${riskScore} below threshold ${threshold}.`
        : 'No risk score — engine treats as below threshold.',
  };
}

function ruleDailyWarning(utilPct: number): RuleTrace {
  const warn = utilPct >= DAILY_WARN_PCT;
  return {
    id: 'daily_warning',
    label: `Daily utilisation below warning band (${DAILY_WARN_PCT}%)`,
    matched: warn,
    severity: 'info',
    detail: warn
      ? `Projected daily utilisation ${utilPct.toFixed(0)}% — approaching the cap.`
      : `Projected daily utilisation ${utilPct.toFixed(0)}%.`,
  };
}

// ── Helpers ────────────────────────────────────────────────────────

function ruleIdToCode(id: RuleTrace['id']): EvaluationTrace['primaryCode'] {
  switch (id) {
    case 'agent_frozen':     return 'FROZEN';
    case 'route_allowlist':  return 'ROUTE_DISALLOWED';
    case 'daily_cap':        return 'DAILY_CAP';
    case 'monthly_cap':      return 'MONTHLY_CAP';
    case 'risk_critical':    return 'RISK';
    case 'human_threshold':  return 'HUMAN_THRESHOLD';
    case 'risk_escalation':  return 'RISK_ESCALATION';
    case 'daily_warning':    return 'ALLOW'; // info only — never decisive
  }
}

function fmt(microUsdc: number): string {
  return (microUsdc / 1_000_000).toFixed(microUsdc < 10_000 ? 4 : 2);
}
