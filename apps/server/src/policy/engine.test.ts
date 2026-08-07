/**
 * Pure engine tests. Run with `node --test --loader tsx dist/…` or `vitest`.
 * Zero external dependencies — this is the same code path both the
 * middleware and the contract logic follow.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { evaluate } from './engine';
import type { EvaluationInput, Policy } from './schema';

const A = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const base: Policy = {
  agentAddress: A,
  dailyCapMicroUsdc: 100_000,       // $0.10
  monthlyCapMicroUsdc: 2_000_000,   // $2.00
  humanThresholdMicroUsdc: 50_000,  // $0.05
  allowedRoutes: ['POST /llm/summarize'],
  riskThreshold: 70,
  frozen: false,
};

const empty = { dailySpentMicroUsdc: 0, monthlySpentMicroUsdc: 0, lastRefreshedAt: new Date() };

function mk(over: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    policy: base,
    route: 'POST /llm/summarize',
    amountMicroUsdc: 10_000,
    spend: empty,
    ...over,
  };
}

test('allow when everything is within limits', () => {
  assert.equal(evaluate(mk()).action, 'allow');
});

test('block when frozen', () => {
  const v = evaluate(mk({ policy: { ...base, frozen: true } }));
  assert.equal(v.action, 'block');
  assert.equal((v as any).code, 'FROZEN');
});

test('block when route not allow-listed', () => {
  const v = evaluate(mk({ route: 'POST /gpu/render' }));
  assert.equal(v.action, 'block');
  assert.equal((v as any).code, 'ROUTE_DISALLOWED');
});

test('block on daily cap breach', () => {
  const v = evaluate(
    mk({ spend: { ...empty, dailySpentMicroUsdc: 95_000 }, amountMicroUsdc: 10_000 })
  );
  assert.equal(v.action, 'block');
  assert.equal((v as any).code, 'DAILY_CAP');
});

test('block on monthly cap breach', () => {
  const v = evaluate(
    mk({
      spend: { ...empty, monthlySpentMicroUsdc: 1_999_500 },
      amountMicroUsdc: 1_000,
    })
  );
  assert.equal(v.action, 'block');
  assert.equal((v as any).code, 'MONTHLY_CAP');
});

test('hard-block on risk >= 90', () => {
  const v = evaluate(mk({ riskScore: 95, riskReason: 'burst pattern' }));
  assert.equal(v.action, 'block');
  assert.equal((v as any).code, 'RISK');
});

test('escalate on amount above human threshold', () => {
  const v = evaluate(
    mk({
      policy: {
        ...base,
        allowedRoutes: ['POST /gpu/render'],
        humanThresholdMicroUsdc: 50_000,
        dailyCapMicroUsdc: 1_000_000,   // room for the escalated call
      },
      route: 'POST /gpu/render',
      amountMicroUsdc: 500_000,
    })
  );
  assert.equal(v.action, 'escalate');
  assert.equal((v as any).code, 'HUMAN_THRESHOLD');
});

test('escalate on medium risk score', () => {
  const v = evaluate(mk({ riskScore: 75 }));
  assert.equal(v.action, 'escalate');
  assert.equal((v as any).code, 'RISK_ESCALATION');
});

test('cap check uses spend + amount, not just amount', () => {
  const v = evaluate(
    mk({ spend: { ...empty, dailySpentMicroUsdc: 90_001 }, amountMicroUsdc: 10_000 })
  );
  assert.equal(v.action, 'block');
  assert.equal((v as any).code, 'DAILY_CAP');
});
