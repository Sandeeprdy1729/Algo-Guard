/**
 * Deterministic policy evaluator.
 *
 * This function is a **pure mirror** of the on-chain policy contract's
 * assertions. If this passes, the atomic group will settle; if this
 * blocks, we save the agent a wasted signature.
 *
 * Order of checks matches the contract exactly — do not reorder without
 * updating contracts/policy_contract.py in lockstep.
 */
import type { EvaluationInput, EvaluationVerdict } from './schema';

export function evaluate(input: EvaluationInput): EvaluationVerdict {
  const { policy, route, amountMicroUsdc, spend, riskScore, riskReason } = input;

  if (policy.frozen) {
    return { action: 'block', code: 'FROZEN', reason: 'Agent is frozen by policy admin.' };
  }

  if (!policy.allowedRoutes.includes(route)) {
    return {
      action: 'block',
      code: 'ROUTE_DISALLOWED',
      reason: `Route "${route}" is not in this agent's allow-list.`,
    };
  }

  if (spend.dailySpentMicroUsdc + amountMicroUsdc > policy.dailyCapMicroUsdc) {
    return {
      action: 'block',
      code: 'DAILY_CAP',
      reason: `Daily cap ${fmt(policy.dailyCapMicroUsdc)} USDC would be exceeded (already spent ${fmt(spend.dailySpentMicroUsdc)}, request ${fmt(amountMicroUsdc)}).`,
    };
  }

  if (spend.monthlySpentMicroUsdc + amountMicroUsdc > policy.monthlyCapMicroUsdc) {
    return {
      action: 'block',
      code: 'MONTHLY_CAP',
      reason: `Monthly cap ${fmt(policy.monthlyCapMicroUsdc)} USDC would be exceeded.`,
    };
  }

  if (typeof riskScore === 'number' && riskScore >= 90) {
    return {
      action: 'block',
      code: 'RISK',
      reason: `Risk score ${riskScore} exceeds hard block threshold (90). ${riskReason ?? ''}`.trim(),
    };
  }

  if (amountMicroUsdc >= policy.humanThresholdMicroUsdc) {
    return {
      action: 'escalate',
      code: 'HUMAN_THRESHOLD',
      reason: `Amount ${fmt(amountMicroUsdc)} USDC is above human-approval threshold ${fmt(policy.humanThresholdMicroUsdc)}.`,
    };
  }

  if (typeof riskScore === 'number' && riskScore >= policy.riskThreshold) {
    return {
      action: 'escalate',
      code: 'RISK_ESCALATION',
      reason: `Risk score ${riskScore} is above configured threshold (${policy.riskThreshold}). ${riskReason ?? ''}`.trim(),
    };
  }

  return { action: 'allow', reason: null };
}

function fmt(microUsdc: number): string {
  return (microUsdc / 1_000_000).toFixed(microUsdc < 10_000 ? 4 : 2);
}
