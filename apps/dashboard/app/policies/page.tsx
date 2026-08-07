'use client';

import { useEffect, useState } from 'react';
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

const EXAMPLES = [
  'Cap this agent at $0.10/day, human approval above $0.05',
  'Freeze all activity',
  'Allow only POST /llm/summarize, block everything else',
  'Set monthly cap to $2, daily cap to $0.20',
];

export default function PoliciesPage() {
  const { data, loading, error, refetch } = useFetch<{ agents: Agent[] }>('/api/agents');
  const [selected, setSelected] = useState<string>('');
  const [prompt, setPrompt] = useState<string>(EXAMPLES[0]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [genError, setGenError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (data && !selected && data.agents[0]) setSelected(data.agents[0].id);
  }, [data, selected]);

  const gen = async () => {
    setBusy(true);
    setCommitted(false);
    setGenError(null);
    try {
      const p = await apiPost<Preview>(`/api/policies/from-text/${selected}`, { prompt });
      setPreview(p);
    } catch (err) {
      setGenError(err instanceof ApiError ? err : new ApiError(String(err), { status: 0 }));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setGenError(null);
    try {
      await apiPost(`/api/policies/${selected}/commit`, { policy: preview.after });
      setCommitted(true);
      await refetch();
    } catch (err) {
      setGenError(err instanceof ApiError ? err : new ApiError(String(err), { status: 0 }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Policies</h1>
        <p className="text-sm text-muted mt-1">
          Write policy in plain English. Claude parses it, we show you the diff, you sign the
          on-chain update from Pera.
        </p>
      </div>

      {loading && <Loading label="Loading agents…" />}
      {error && (
        <ErrorBanner
          title="Could not load agents"
          detail={error.message}
          requestId={error.requestId}
          onRetry={refetch}
        />
      )}
      {data && data.agents.length === 0 && (
        <Empty>
          Register an agent first from{' '}
          <a href="/agents" className="text-accent underline">
            Agents
          </a>
          .
        </Empty>
      )}

      {data && data.agents.length > 0 && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-xs text-muted uppercase tracking-wide">Agent</label>
            <select
              className="bg-bg border border-border rounded px-3 py-2 text-sm text-text"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {data.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.algoAddress.slice(0, 8)}…
                </option>
              ))}
            </select>
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="w-full bg-bg border border-border rounded p-3 font-mono text-sm text-text"
            placeholder="Describe the policy in plain English…"
          />

          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                className="pill border-border hover:border-accent hover:text-accent text-muted"
                onClick={() => setPrompt(e)}
              >
                {e}
              </button>
            ))}
          </div>

          <button
            disabled={!selected || busy || prompt.trim().length < 3}
            onClick={gen}
            className="px-4 py-2 bg-accent text-bg font-medium rounded disabled:opacity-40"
          >
            {busy ? 'Parsing…' : 'Generate policy'}
          </button>

          {genError && (
            <ErrorBanner
              title="Policy operation failed"
              detail={genError.message}
              requestId={genError.requestId}
            />
          )}
        </div>
      )}

      {preview && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-sm uppercase text-muted tracking-wide">Diff</h2>
            {committed && <span className="pill border-accent text-accent bg-accent/10">committed</span>}
          </div>

          {preview.changes.length === 0 ? (
            <div className="text-sm text-muted">
              No changes — instruction did not alter the policy.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted text-xs uppercase">
                <tr>
                  <th className="py-2 pr-4">Field</th>
                  <th className="py-2 pr-4">Before</th>
                  <th className="py-2">After</th>
                </tr>
              </thead>
              <tbody>
                {preview.changes.map((c) => (
                  <tr key={c.field} className="border-t border-border">
                    <td className="py-2 pr-4 font-mono text-xs">{c.field}</td>
                    <td className="py-2 pr-4 font-mono text-danger text-xs">
                      {fmtValue(c.field, c.from)}
                    </td>
                    <td className="py-2 font-mono text-accent text-xs">
                      {fmtValue(c.field, c.to)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <button
            onClick={commit}
            disabled={busy || preview.changes.length === 0}
            className="px-4 py-2 bg-accent text-bg font-medium rounded disabled:opacity-40"
          >
            {busy ? 'Committing…' : 'Sign & commit to chain'}
          </button>
          <p className="text-xs text-muted">
            The commit writes to Postgres immediately; a subsequent Pera signature (once the
            contract is deployed) pushes the update on-chain via{' '}
            <code className="font-mono">policy_contract.update_policy</code>.
          </p>
        </div>
      )}
    </div>
  );
}

function fmtValue(field: string, v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number' && field.endsWith('MicroUsdc')) return fmtUsdc(v);
  if (Array.isArray(v)) return v.join(', ') || '∅';
  return String(v);
}
