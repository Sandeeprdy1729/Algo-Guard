'use client';

export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ApiError, apiPost, fmtUsdc, shortAddr } from '@/lib/api';
import { useFetch } from '@/lib/swr';
import { Empty, ErrorBanner, Loading, Progress, StatusPill } from '@/components/ui';

interface Agent {
  id: string;
  name: string;
  algoAddress: string;
  status: 'active' | 'frozen';
  policy: null | {
    dailyCapMicroUsdc: number;
    monthlyCapMicroUsdc: number;
    humanThresholdMicroUsdc: number;
    allowedRoutes: string[];
  };
  spend: { dailySpentMicroUsdc: number };
}
interface AgentsResponse {
  agents: Agent[];
  availableRoutes: string[];
}

export default function AgentsPage() {
  const { data, loading, error, refetch } = useFetch<AgentsResponse>('/api/agents');
  const [form, setForm] = useState({
    userEmail: 'demo@agentguard.dev',
    name: '',
    algoAddress: '',
    adminAddress: '',
  });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const canSubmit =
    form.name.trim().length > 0 &&
    form.algoAddress.length === 58 &&
    form.adminAddress.length > 0 &&
    form.userEmail.includes('@');

  const submit = async () => {
    setBusy(true); setFormError(null); setNotice(null);
    try {
      await apiPost('/api/agents', form);
      setNotice(`Registered "${form.name}" (${shortAddr(form.algoAddress)})`);
      setForm((f) => ({ ...f, name: '', algoAddress: '' }));
      setShowForm(false);
      await refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err : new ApiError(String(err), { status: 0 }));
    } finally { setBusy(false); }
  };

  const total = data?.agents.length ?? 0;
  const active = useMemo(() => data?.agents.filter((a) => a.status === 'active').length ?? 0, [data]);
  const frozen = total - active;

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <div className="sec-label">Registered fleet</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tightest text-text">Agents</h1>
          <p className="mt-1 text-sm text-text-2">
            Every account under AgentGuard policy — {total} total, {active} active
            {frozen > 0 && `, ${frozen} frozen`}.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className={showForm ? 'btn btn-ghost' : 'btn btn-primary'}
        >
          {showForm ? 'Cancel' : '+ Register agent'}
        </button>
      </header>

      {notice && (
        <div className="rounded-lg border border-ok/40 bg-ok/5 px-4 py-2.5 text-sm text-ok flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-ok" />
          {notice}
        </div>
      )}

      {showForm && (
        <div className="card p-6 space-y-4">
          <div className="sec-label">Register a new agent</div>
          <div className="grid md:grid-cols-4 gap-3">
            {(['name', 'algoAddress', 'adminAddress', 'userEmail'] as const).map((k) => (
              <label key={k} className="block">
                <span className="sec-label">{k}</span>
                <input
                  value={form[k]}
                  onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                  placeholder={
                    k === 'algoAddress' ? '58-char TestNet address' :
                    k === 'adminAddress' ? '58-char admin address' :
                    k === 'userEmail' ? 'you@example.com' : 'Human-readable name'
                  }
                  className="mt-1 w-full bg-bg border border-border rounded-md px-3 py-2 text-sm font-mono
                             text-text placeholder:text-dim focus:outline-none focus:border-accent
                             transition-colors duration-150"
                />
              </label>
            ))}
          </div>
          {form.algoAddress.length > 0 && form.algoAddress.length !== 58 && (
            <div className="text-2xs font-mono text-warn">
              algoAddress must be 58 characters ({form.algoAddress.length}/58)
            </div>
          )}
          <div className="flex items-center gap-3 pt-2">
            <button disabled={busy || !canSubmit} onClick={submit} className="btn btn-primary">
              {busy ? 'Registering…' : 'Register agent'}
            </button>
            {formError && (
              <div className="text-2xs text-danger font-mono">{formError.message}</div>
            )}
          </div>
        </div>
      )}

      {error && <ErrorBanner title="Could not load agents" detail={error.message} requestId={error.requestId} onRetry={refetch} />}
      {loading && <Loading label="Loading agents" />}
      {data && (
        data.agents.length === 0 ? (
          <Empty>No agents yet. Register one above to start seeing policy activity.</Empty>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="sec-label px-5 py-3 font-normal">Agent</th>
                  <th className="sec-label px-5 py-3 font-normal">Status</th>
                  <th className="sec-label px-5 py-3 font-normal text-right">Daily spend</th>
                  <th className="sec-label px-5 py-3 font-normal text-right">Escalate ≥</th>
                  <th className="sec-label px-5 py-3 font-normal">Routes</th>
                </tr>
              </thead>
              <tbody>
                {data.agents.map((a) => (
                  <tr key={a.id} className="border-t border-border hover:bg-surface-2/60 transition-colors duration-150 group">
                    <td className="px-5 py-4">
                      <Link href={`/agents/${a.id}`} className="block group-hover:text-accent transition-colors">
                        <div className="text-text text-[13px] font-medium">{a.name}</div>
                        <div className="text-2xs font-mono text-muted mt-0.5">{shortAddr(a.algoAddress)}</div>
                      </Link>
                    </td>
                    <td className="px-5 py-4">
                      <StatusPill status={a.status} />
                    </td>
                    <td className="px-5 py-4 text-right w-64">
                      <div className="text-[13px] num text-text-2">
                        {fmtUsdc(a.spend.dailySpentMicroUsdc)}
                        <span className="text-muted mx-1.5">/</span>
                        {a.policy ? fmtUsdc(a.policy.dailyCapMicroUsdc) : '—'}
                      </div>
                      {a.policy && (
                        <div className="mt-1.5">
                          <Progress
                            value={a.spend.dailySpentMicroUsdc}
                            max={a.policy.dailyCapMicroUsdc}
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right text-[13px] num text-text-2">
                      {a.policy ? fmtUsdc(a.policy.humanThresholdMicroUsdc) : '—'}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-1">
                        {(a.policy?.allowedRoutes ?? []).map((r) => (
                          <span key={r} className="pill border-border/70 text-text-2 font-mono normal-case tracking-normal">
                            {r}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
