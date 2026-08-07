'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ApiError, apiPost, fmtUsdc, shortAddr } from '@/lib/api';
import { useFetch } from '@/lib/swr';
import { Empty, ErrorBanner, Loading, StatusPill } from '@/components/ui';

interface Agent {
  id: string;
  name: string;
  algoAddress: string;
  status: string;
  policy: null | {
    dailyCapMicroUsdc: number;
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

  const canSubmit =
    form.name.trim().length > 0 &&
    form.algoAddress.length === 58 &&
    form.adminAddress.length > 0 &&
    form.userEmail.includes('@');

  const submit = async () => {
    setBusy(true);
    setFormError(null);
    setNotice(null);
    try {
      await apiPost('/api/agents', form);
      setNotice(`Registered "${form.name}" (${shortAddr(form.algoAddress)})`);
      setForm((f) => ({ ...f, name: '', algoAddress: '' }));
      await refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err : new ApiError(String(err), { status: 0 }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>

      <div className="card p-6 space-y-4">
        <h2 className="text-sm uppercase text-muted tracking-wide">Register a new agent</h2>
        <div className="grid grid-cols-4 gap-3">
          {(['name', 'algoAddress', 'adminAddress', 'userEmail'] as const).map((k) => (
            <label key={k} className="text-xs text-muted uppercase tracking-wide">
              {k}
              <input
                value={(form as any)[k]}
                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                placeholder={
                  k === 'algoAddress'
                    ? '58-char TestNet address'
                    : k === 'adminAddress'
                      ? 'admin 58-char'
                      : k
                }
                className="mt-1 w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono normal-case text-text"
              />
            </label>
          ))}
        </div>
        {form.algoAddress.length > 0 && form.algoAddress.length !== 58 && (
          <div className="text-xs text-warn">algoAddress must be 58 characters ({form.algoAddress.length}/58)</div>
        )}
        <div className="flex items-center gap-3">
          <button
            disabled={busy || !canSubmit}
            onClick={submit}
            className="px-4 py-2 bg-accent text-bg font-medium rounded disabled:opacity-40"
          >
            {busy ? 'Registering…' : 'Register agent'}
          </button>
          {notice && <span className="text-xs text-accent">{notice}</span>}
        </div>
        {formError && (
          <ErrorBanner
            title="Registration failed"
            detail={formError.message}
            requestId={formError.requestId}
          />
        )}
        {data && (
          <p className="text-xs text-muted">
            Available routes: <span className="font-mono">{data.availableRoutes.join(', ')}</span>
          </p>
        )}
      </div>

      {error && (
        <ErrorBanner
          title="Could not load agents"
          detail={error.message}
          requestId={error.requestId}
          onRetry={refetch}
        />
      )}
      {loading && <Loading label="Loading agents…" />}
      {data && (
        <div className="card">
          {data.agents.length === 0 ? (
            <Empty>No agents yet. Register one above to start seeing policy activity.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted text-xs uppercase tracking-wide">
                <tr>
                  <th className="p-4">Name</th>
                  <th className="p-4">Address</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Daily / cap</th>
                  <th className="p-4">Escalation ≥</th>
                  <th className="p-4">Routes</th>
                </tr>
              </thead>
              <tbody>
                {data.agents.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="p-4">
                      <Link href={`/agents/${a.id}`} className="text-accent hover:underline">
                        {a.name}
                      </Link>
                    </td>
                    <td className="p-4 font-mono text-xs">{shortAddr(a.algoAddress)}</td>
                    <td className="p-4">
                      <StatusPill status={a.status} />
                    </td>
                    <td className="p-4 font-mono">
                      {fmtUsdc(a.spend.dailySpentMicroUsdc)} /{' '}
                      {a.policy ? fmtUsdc(a.policy.dailyCapMicroUsdc) : '—'}
                    </td>
                    <td className="p-4 font-mono">
                      {a.policy ? fmtUsdc(a.policy.humanThresholdMicroUsdc) : '—'}
                    </td>
                    <td className="p-4 text-xs text-muted font-mono">
                      {a.policy?.allowedRoutes.join(', ') ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
