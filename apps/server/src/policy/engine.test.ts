/**
 * Pure engine tests. Run with `node --test --loader tsx dist/…` or `vitest`.
 * Zero external dependencies — this is the same code path both the
 * middleware and the contract logic follow.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { evaluate, trace } from './engine';
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

// ── trace() — the verbose shape used by the dashboard + MCP ───────

test('trace: allow returns rules array with none matched (except info)', () => {
  const t = trace(mk());
  assert.equal(t.decision, 'ALLOW');
  assert.equal(t.primaryCode, 'ALLOW');
  assert.equal(t.routeAllowed, true);
  assert.ok(t.rules.length >= 7, 'engine emits ≥7 rules');
  const decisive = t.rules.filter((r) => r.matched && r.severity !== 'info');
  assert.equal(decisive.length, 0, 'no decisive rule fires on an allow');
});

test('trace: frozen is the first fired rule, no matter what else is wrong', () => {
  // Route not in allowlist AND frozen — frozen must win by precedence.
  const t = trace(
    mk({
      policy: { ...base, frozen: true },
      route: 'POST /gpu/render',
    })
  );
  assert.equal(t.decision, 'BLOCK');
  assert.equal(t.primaryCode, 'FROZEN');
  const first = t.rules.find((r) => r.matched && r.severity !== 'info');
  assert.equal(first?.id, 'agent_frozen');
});

test('trace: spendingState is populated even on ALLOW', () => {
  const t = trace(mk({ amountMicroUsdc: 50_000 }));
  assert.equal(t.spendingState.dailyCapMicroUsdc, base.dailyCapMicroUsdc);
  assert.equal(t.spendingState.remainingDailyMicroUsdc, base.dailyCapMicroUsdc);
  assert.equal(t.spendingState.amountMicroUsdc, 50_000);
  assert.ok(t.spendingState.projectedDailyUtilPct > 0);
});

test('trace: daily_warning is info (never decisive) even when matched', () => {
  // 80% utilization triggers the info-band warn but the decision is ALLOW.
  const t = trace(
    mk({ spend: { ...empty, dailySpentMicroUsdc: 80_000 }, amountMicroUsdc: 0 })
  );
  const warn = t.rules.find((r) => r.id === 'daily_warning');
  assert.equal(warn?.matched, true);
  assert.equal(warn?.severity, 'info');
  assert.equal(t.decision, 'ALLOW');
});

test('trace: matches evaluate() for every branch', () => {
  const cases: EvaluationInput[] = [
    mk(),
    mk({ policy: { ...base, frozen: true } }),
    mk({ route: 'POST /gpu/render' }),
    mk({ spend: { ...empty, dailySpentMicroUsdc: 95_000 }, amountMicroUsdc: 10_000 }),
    mk({ riskScore: 95 }),
    mk({ riskScore: 75 }),
  ];
  for (const input of cases) {
    const v = evaluate(input);
    const t = trace(input);
    const expected =
      v.action === 'allow' ? 'ALLOW'
      : v.action === 'block' ? 'BLOCK'
      : 'ESCALATE';
    assert.equal(t.decision, expected, `mismatch for ${JSON.stringify(input.policy.frozen)}`);
  }
});
