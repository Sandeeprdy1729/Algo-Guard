'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { ApiError, apiPost, fmtUsdc } from '@/lib/api';
import { useFetch } from '@/lib/swr';
import { Empty, ErrorBanner, Loading } from '@/components/ui';

interface Agent {
  id: string;
  name: string;
  algoAddress: string;
  policy: null | {
    dailyCapMicroUsdc: number;
    monthlyCapMicroUsdc: number;
    humanThresholdMicroUsdc: number;
    allowedRoutes: string[];
    riskThreshold: number;
  };
}

interface Preview {
  before: any;
  after: any;
  changes: { field: string; from: unknown; to: unknown }[];
}

type Stage = 'idle' | 'parsing' | 'review' | 'committing' | 'success';

const EXAMPLES = [
  'Cap this agent at $0.10 per day, human approval above $0.05',
  'Freeze all activity',
  'Allow only POST /llm/summarize, block everything else',
  'Set monthly cap to $2, daily cap to $0.20',
];

const STAGES: { key: Stage; label: string }[] = [
  { key: 'idle',       label: 'Compose' },
  { key: 'parsing',    label: 'Interpret' },
  { key: 'review',     label: 'Review' },
  { key: 'committing', label: 'Commit' },
  { key: 'success',    label: 'Deployed' },
];

export default function PoliciesPage() {
  const { data, loading, error, refetch } = useFetch<{ agents: Agent[] }>('/api/agents');
  const [selected, setSelected] = useState<string>('');
  const [prompt, setPrompt] = useState<string>(EXAMPLES[0]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [genError, setGenError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (data && !selected && data.agents[0]) setSelected(data.agents[0].id);
  }, [data, selected]);

  const gen = async () => {
    setGenError(null); setStage('parsing');
    try {
      const p = await apiPost<Preview>(`/api/policies/from-text/${selected}`, { prompt });
      setPreview(p);
      setStage('review');
    } catch (err) {
      setGenError(err instanceof ApiError ? err : new ApiError(String(err), { status: 0 }));
      setStage('idle');
    }
  };

  const commit = async () => {
    if (!preview) return;
    setStage('committing'); setGenError(null);
    try {
      await apiPost(`/api/policies/${selected}/commit`, { policy: preview.after });
      setStage('success');
      await refetch();
      setTimeout(() => setStage('idle'), 3500);
    } catch (err) {
      setGenError(err instanceof ApiError ? err : new ApiError(String(err), { status: 0 }));
      setStage('review');
    }
  };

  const currentAgent = data?.agents.find((a) => a.id === selected);

  return (
    <div className="space-y-8">
      <header>
        <div className="sec-label">Governance</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tightest text-text">
          Policies
        </h1>
        <p className="mt-1 text-sm text-text-2 max-w-[64ch]">
          Author a spending policy in plain English. Groq's Llama-3.3 parses it, we show you
          the diff, and you commit the update.
        </p>
      </header>

      {loading && <Loading label="Loading agents" />}
      {error && (
        <ErrorBanner title="Could not load agents" detail={error.message} requestId={error.requestId} onRetry={refetch} />
      )}
      {data && data.agents.length === 0 && (
        <Empty>
          Register an agent first from{' '}
          <a href="/agents" className="text-accent underline">Agents</a>.
        </Empty>
      )}

      {data && data.agents.length > 0 && (
        <>
          <StageBar stage={stage} />

          <div className="card p-6 space-y-5">
            {/* Agent selector */}
            <div className="flex items-center gap-3">
              <div className="sec-label">Agent</div>
              <select
                className="bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text
                           focus:outline-none focus:border-accent transition-colors duration-150"
                value={selected}
                onChange={(e) => { setSelected(e.target.value); setPreview(null); setStage('idle'); }}
                disabled={stage === 'parsing' || stage === 'committing'}
              >
                {data.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.algoAddress.slice(0, 8)}…
                  </option>
                ))}
              </select>
            </div>

            {/* Prompt */}
            <div>
              <div className="sec-label mb-2">Describe your policy</div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                disabled={stage === 'parsing' || stage === 'committing'}
                placeholder="e.g. Cap this agent at $2 per day, require human approval above $0.10, allow only POST /llm/summarize."
                className="w-full bg-bg border border-border rounded-md p-3 text-[14px] leading-relaxed
                           text-text placeholder:text-dim focus:outline-none focus:border-accent
                           transition-colors duration-150 resize-none disabled:opacity-60"
              />
            </div>

            {/* Examples */}
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <button
                  key={e}
                  disabled={stage === 'parsing' || stage === 'committing'}
                  className="text-2xs px-2.5 py-1 rounded-md border border-border text-muted
                             hover:border-border-2 hover:text-text-2 transition-colors duration-150
                             disabled:opacity-50"
                  onClick={() => setPrompt(e)}
                >
                  {e}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                disabled={!selected || stage === 'parsing' || stage === 'committing' || prompt.trim().length < 3}
                onClick={gen}
                className="btn btn-primary"
              >
                {stage === 'parsing' ? 'Interpreting…' : 'Generate policy'}
              </button>
              {genError && (
                <span className="text-2xs text-danger font-mono">{genError.message}</span>
              )}
            </div>
          </div>

          {/* Current policy */}
          {currentAgent?.policy && (
            <div className="card p-6 space-y-3">
              <div className="sec-label">Currently deployed</div>
              <div className="grid md:grid-cols-4 gap-4">
                <MiniCell label="Daily cap"     value={fmtUsdc(currentAgent.policy.dailyCapMicroUsdc)} />
                <MiniCell label="Monthly cap"   value={fmtUsdc(currentAgent.policy.monthlyCapMicroUsdc)} />
                <MiniCell label="Human ≥"       value={fmtUsdc(currentAgent.policy.humanThresholdMicroUsdc)} />
                <MiniCell label="Risk cutoff"   value={String(currentAgent.policy.riskThreshold)} />
              </div>
              <div className="text-2xs font-mono text-muted">
                {currentAgent.policy.allowedRoutes.length} allowed route
                {currentAgent.policy.allowedRoutes.length === 1 ? '' : 's'}:{' '}
                {currentAgent.policy.allowedRoutes.join(' · ')}
              </div>
            </div>
          )}

          {/* Diff review */}
          {preview && stage !== 'idle' && (
            <div className="card p-6 space-y-4 animate-row-in">
              <div className="flex items-center justify-between">
                <div>
                  <div className="sec-label">Interpretation</div>
                  <div className="mt-0.5 text-[13px] text-text">
                    Groq → validated JSON → policy engine
                  </div>
                </div>
                {stage === 'success' && (
                  <span className="pill border-ok/40 text-ok bg-ok/5">
                    <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Deployed
                  </span>
                )}
              </div>

              {preview.changes.length === 0 ? (
                <div className="text-sm text-muted">
                  No changes — instruction did not alter the policy.
                </div>
              ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-2">
                      <tr>
                        <th className="sec-label px-4 py-2.5 text-left font-normal">Field</th>
                        <th className="sec-label px-4 py-2.5 text-left font-normal">Before</th>
                        <th className="sec-label px-4 py-2.5 text-left font-normal">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.changes.map((c) => (
                        <tr key={c.field} className="border-t border-border">
                          <td className="px-4 py-2.5 font-mono text-2xs text-muted">{c.field}</td>
                          <td className="px-4 py-2.5 font-mono text-2xs">
                            <span className="text-danger">{fmtValue(c.field, c.from)}</span>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-2xs">
                            <span className="text-ok">{fmtValue(c.field, c.to)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={commit}
                  disabled={stage === 'committing' || preview.changes.length === 0}
                  className="btn btn-ok"
                >
                  {stage === 'committing' && 'Committing…'}
                  {stage === 'success' && '✓ Deployed'}
                  {(stage === 'review' || stage === 'parsing') && 'Commit policy'}
                </button>
                <button
                  onClick={() => { setPreview(null); setStage('idle'); }}
                  disabled={stage === 'committing'}
                  className="btn btn-ghost"
                >
                  Discard
                </button>
                <span className="text-2xs text-muted">
                  Writes to Postgres immediately. On-chain <span className="font-mono">update_policy</span> requires a Pera signature (roadmap).
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StageBar({ stage }: { stage: Stage }) {
  const activeIdx = STAGES.findIndex((s) => s.key === stage);
  return (
    <div className="flex items-center gap-2 text-2xs font-mono uppercase tracking-widest">
      {STAGES.map((s, i) => {
        const isActive = i === activeIdx;
        const isDone = i < activeIdx;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <span
              className={clsx(
                'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border transition-colors duration-200',
                isActive && 'border-accent text-accent bg-accent/5',
                isDone   && 'border-ok/40 text-ok',
                !isActive && !isDone && 'border-border text-muted',
              )}
            >
              <span
                className={clsx(
                  'h-1.5 w-1.5 rounded-full',
                  isActive && 'bg-accent animate-pulse-slow',
                  isDone   && 'bg-ok',
                  !isActive && !isDone && 'bg-dim',
                )}
              />
              {s.label}
            </span>
            {i < STAGES.length - 1 && (
              <span aria-hidden className={clsx('h-px w-6', isDone ? 'bg-ok/40' : 'bg-border')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function MiniCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="sec-label">{label}</div>
      <div className="mt-1 text-[15px] num tracking-tightest text-text">{value}</div>
    </div>
  );
}

function fmtValue(field: string, v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number' && field.endsWith('MicroUsdc')) return fmtUsdc(v);
  if (Array.isArray(v)) return v.join(', ') || '∅';
  return String(v);
}
