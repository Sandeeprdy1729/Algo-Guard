'use client';

/**
 * PolicyEvaluation
 *
 * Interactive "what would the engine decide?" panel. Posts the picked
 * route + amount + optional risk-score override to
 *   POST /api/policies/simulate/:agentId
 * and renders the returned rule trace.
 *
 * All engine logic lives on the server — this component is a pure
 * renderer, no policy math here.
 */

import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { apiPost, fmtUsdc, ApiError } from '@/lib/api';
import { Progress } from '@/components/ui';

type Severity = 'info' | 'warn' | 'escalate' | 'block';
type Decision = 'ALLOW' | 'BLOCK' | 'ESCALATE';

interface RuleTrace {
  id: string;
  label: string;
  matched: boolean;
  severity: Severity;
  detail: string;
}

interface SpendingState {
  dailySpentMicroUsdc: number;
  dailyCapMicroUsdc: number;
  monthlySpentMicroUsdc: number;
  monthlyCapMicroUsdc: number;
  remainingDailyMicroUsdc: number;
  remainingMonthlyMicroUsdc: number;
  amountMicroUsdc: number;
  projectedDailyUtilPct: number;
}

interface SimulateResponse {
  agent: { id: string; name: string; address: string; status: string };
  input: {
    route: string;
    amountMicroUsdc: number;
    riskScore: number | null;
    riskReason: string | null;
    overrideApplied: boolean;
  };
  trace: {
    decision: Decision;
    primaryCode: string;
    reason: string | null;
    routeAllowed: boolean;
    riskScore: number | null;
    riskThreshold: number;
    spendingState: SpendingState;
    rules: RuleTrace[];
  };
}

export function PolicyEvaluation({
  agentId,
  availableRoutes,
}: {
  agentId: string;
  availableRoutes: string[];
}) {
  const first = availableRoutes[0] ?? 'POST /llm/summarize';
  const [route, setRoute] = useState(first);
  const [amount, setAmount] = useState<string>('');       // USDC as string
  const [risk, setRisk] = useState<string>('');           // 0..100 as string
  const [result, setResult] = useState<SimulateResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const amountMicroUsdc = amount === ''
        ? undefined
        : Math.round(parseFloat(amount) * 1_000_000);
      const riskScore = risk === '' ? undefined : Math.max(0, Math.min(100, parseFloat(risk)));
      const res = await apiPost<SimulateResponse>(
        `/api/policies/simulate/${agentId}`,
        { route, amountMicroUsdc, riskScore }
      );
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), { status: 0 }));
    } finally {
      setBusy(false);
    }
  }

  // Run once on mount so the panel isn't empty on first paint.
  useEffect(() => { void run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agentId]);

  return (
    <section className="card p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="sec-label">Policy evaluation</div>
          <div className="text-[13px] text-text mt-0.5">
            Simulate a request without spending USDC
          </div>
        </div>
        <span className="text-2xs font-mono text-muted uppercase tracking-widest">
          engine trace
        </span>
      </div>

      <div className="grid md:grid-cols-4 gap-3">
        <label className="col-span-2 flex flex-col gap-1.5">
          <span className="sec-label">Route</span>
          <select
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            className="input font-mono text-[13px]"
          >
            {availableRoutes.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="sec-label">Amount USDC</span>
          <input
            type="number"
            step="0.0001"
            min="0"
            placeholder="default"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input num"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="sec-label">Risk 0–100</span>
          <input
            type="number"
            step="1"
            min="0"
            max="100"
            placeholder="skip"
            value={risk}
            onChange={(e) => setRisk(e.target.value)}
            className="input num"
          />
        </label>
      </div>

      <div className="flex items-center justify-between">
        <button onClick={run} disabled={busy} className="btn btn-accent">
          {busy ? 'Evaluating…' : 'Simulate'}
        </button>
        {result && (
          <div className="text-2xs font-mono text-muted">
            Amount {fmtUsdc(result.input.amountMicroUsdc)}
            {result.input.riskScore != null && (
              <> · Risk {result.input.riskScore}</>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="text-2xs text-danger">
          Simulation failed: {error.message}
        </div>
      )}

      {result && (
        <>
          <DecisionBanner
            decision={result.trace.decision}
            code={result.trace.primaryCode}
            reason={result.trace.reason}
          />

          <SpendingRow state={result.trace.spendingState} />

          <div className="rule" />

          <div>
            <div className="sec-label mb-2">
              Rules considered (in precedence order)
            </div>
            <ol className="space-y-1.5">
              {result.trace.rules.map((r, i) => (
                <RuleLine key={r.id} rule={r} index={i} />
              ))}
            </ol>
          </div>
        </>
      )}
    </section>
  );
}

// ── subcomponents ─────────────────────────────────────────────────

function DecisionBanner({
  decision,
  code,
  reason,
}: {
  decision: Decision;
  code: string;
  reason: string | null;
}) {
  const tone =
    decision === 'ALLOW' ? 'ok'
    : decision === 'ESCALATE' ? 'warn'
    : 'danger';

  return (
    <div
      className={clsx('rounded-xl border p-4', {
        'border-ok/40 bg-ok/5':         tone === 'ok',
        'border-warn/40 bg-warn/5':     tone === 'warn',
        'border-danger/40 bg-danger/5': tone === 'danger',
      })}
    >
      <div className="flex items-center gap-2">
        <span
          className={clsx('h-2 w-2 rounded-full', {
            'bg-ok':     tone === 'ok',
            'bg-warn':   tone === 'warn',
            'bg-danger': tone === 'danger',
          })}
        />
        <span className={clsx('text-2xs font-mono uppercase tracking-widest', {
          'text-ok':     tone === 'ok',
          'text-warn':   tone === 'warn',
          'text-danger': tone === 'danger',
        })}>
          {decision}
        </span>
        <span className="text-2xs text-muted font-mono">·</span>
        <span className="text-2xs text-muted font-mono">{code}</span>
      </div>
      {reason && (
        <div className="mt-1.5 text-[13px] text-text-2 leading-relaxed">
          {reason}
        </div>
      )}
    </div>
  );
}

function SpendingRow({ state }: { state: SpendingState }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <div className="sec-label">Projected daily</div>
          <div className="text-2xs font-mono text-muted num">
            {fmtUsdc(state.dailySpentMicroUsdc + state.amountMicroUsdc)}
            {' / '}
            {fmtUsdc(state.dailyCapMicroUsdc)}
          </div>
        </div>
        <Progress
          value={state.dailySpentMicroUsdc + state.amountMicroUsdc}
          max={state.dailyCapMicroUsdc}
          showLegend
        />
      </div>
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <div className="sec-label">Projected monthly</div>
          <div className="text-2xs font-mono text-muted num">
            {fmtUsdc(state.monthlySpentMicroUsdc + state.amountMicroUsdc)}
            {' / '}
            {fmtUsdc(state.monthlyCapMicroUsdc)}
          </div>
        </div>
        <Progress
          value={state.monthlySpentMicroUsdc + state.amountMicroUsdc}
          max={state.monthlyCapMicroUsdc}
          showLegend
        />
      </div>
    </div>
  );
}

function RuleLine({ rule, index }: { rule: RuleTrace; index: number }) {
  // Colour = severity. Filled bullet = matched. `info` rules ride
  // the muted rail unless they actually fire — the daily-warning rule
  // is the one that lights up amber when matched.
  type ActiveTone = 'ok' | 'warn' | 'danger' | 'muted';
  const activeTone: ActiveTone = !rule.matched
    ? 'muted'
    : rule.severity === 'block'    ? 'danger'
    : rule.severity === 'escalate' ? 'warn'
    : rule.severity === 'warn'     ? 'warn'
    : rule.severity === 'info'     ? 'warn'
    : 'ok';

  return (
    <li className="flex items-start gap-3 py-1">
      <span
        aria-hidden
        className={clsx(
          'flex-none mt-1.5 h-2 w-2 rounded-full',
          {
            'bg-ok':     activeTone === 'ok',
            'bg-warn':   activeTone === 'warn',
            'bg-danger': activeTone === 'danger',
            'bg-dim ring-1 ring-border': activeTone === 'muted',
          },
        )}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-2xs font-mono text-muted w-4 text-right">
            {(index + 1).toString().padStart(2, '0')}
          </span>
          <span className={clsx('text-[13px]', {
            'text-text':  rule.matched,
            'text-muted line-through decoration-dim/40': !rule.matched,
          })}>
            {rule.label}
          </span>
          <span
            className={clsx(
              'pill text-2xs',
              {
                'border-danger/40 text-danger bg-danger/5': rule.severity === 'block',
                'border-warn/40 text-warn bg-warn/5':       rule.severity === 'escalate' || rule.severity === 'warn',
                'border-border text-muted':                 rule.severity === 'info',
              },
              !rule.matched && 'opacity-40',
            )}
          >
            {rule.severity}
          </span>
        </div>
        <div className={clsx('text-2xs mt-0.5 leading-relaxed', {
          'text-text-2': rule.matched,
          'text-muted':  !rule.matched,
        })}>
          {rule.detail}
        </div>
      </div>
    </li>
  );
}
