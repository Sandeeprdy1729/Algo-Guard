'use client';

import { useEffect, useState } from 'react';
import { apiGet, ApiError, fmtUsdc, relTime, shortAddr } from '@/lib/api';
import { useEventStream } from '@/lib/stream';
import { Empty, ErrorBanner, Loading, StatusPill } from '@/components/ui';

interface Tx {
  id: string;
  agentName?: string;
  agentAddress?: string;
  route: string;
  amountMicroUsdc: number;
  status: string;
  riskScore: number | null;
  loraUrl: string | null;
  createdAt: string;
}

interface Agent {
  id: string;
  name: string;
  algoAddress: string;
  status: string;
  policy: null | { dailyCapMicroUsdc: number; humanThresholdMicroUsdc: number };
  spend: { dailySpentMicroUsdc: number };
}

export default function Overview() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [txns, setTxns] = useState<Tx[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const { connected } = useEventStream({
    transaction: (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        setTxns((prev) => [{ ...data } as Tx, ...(prev ?? [])].slice(0, 40));
      } catch {}
    },
  });

  const load = async () => {
    try {
      setError(null);
      const [a, t] = await Promise.all([
        apiGet<{ agents: Agent[] }>('/api/agents'),
        apiGet<{ transactions: Tx[] }>('/api/audit?limit=30'),
      ]);
      setAgents(a.agents);
      setTxns(t.transactions);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), { status: 0 }));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (error) {
    return (
      <ErrorBanner
        title="Could not load overview"
        detail={error.message}
        requestId={error.requestId}
        onRetry={load}
      />
    );
  }
  if (!agents || !txns) return <Loading label="Loading overview…" />;

  const totalDaily = agents.reduce((s, a) => s + (a.spend?.dailySpentMicroUsdc ?? 0), 0);
  const totalCap = agents.reduce((s, a) => s + (a.policy?.dailyCapMicroUsdc ?? 0), 0);
  const pending = txns.filter((t) => t.status === 'escalated').length;
  const blocked = txns.filter((t) => t.status.startsWith('blocked')).length;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <span
          className={
            'pill ' + (connected ? 'border-accent text-accent' : 'border-muted text-muted')
          }
        >
          {connected ? 'live' : 'reconnecting'}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Stat label="Agents" value={agents.length} sub="under policy" />
        <Stat label="Daily spend" value={fmtUsdc(totalDaily)} sub={`of ${fmtUsdc(totalCap)} cap`} />
        <Stat
          label="Pending approvals"
          value={pending}
          sub="escalated"
          tone={pending ? 'warn' : undefined}
        />
        <Stat
          label="Blocked"
          value={blocked}
          sub="last 30 requests"
          tone={blocked ? 'danger' : undefined}
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card p-5 col-span-1">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">Agents</h2>
          {agents.length === 0 ? (
            <Empty>Register an agent to see traffic.</Empty>
          ) : (
            <ul className="space-y-2">
              {agents.map((a) => (
                <li key={a.id} className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-muted font-mono">{shortAddr(a.algoAddress)}</div>
                  </div>
                  <div className="text-right text-xs">
                    <div className="text-muted">daily</div>
                    <div className="font-mono">
                      {fmtUsdc(a.spend.dailySpentMicroUsdc)} /{' '}
                      {fmtUsdc(a.policy?.dailyCapMicroUsdc ?? 0)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-5 col-span-2">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">
            Live activity
          </h2>
          {txns.length === 0 ? (
            <Empty>No traffic yet. Run the demo agent to populate.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {txns.map((t) => (
                <li key={t.id} className="py-2 text-sm flex items-center gap-3">
                  <StatusPill status={t.status} />
                  <span className="font-mono text-xs text-muted">{t.route}</span>
                  <span className="font-mono">{fmtUsdc(t.amountMicroUsdc)}</span>
                  {t.riskScore != null && (
                    <span className="text-xs text-muted">risk {t.riskScore}</span>
                  )}
                  <span className="ml-auto text-xs text-muted">{relTime(t.createdAt)}</span>
                  {t.loraUrl && (
                    <a
                      href={t.loraUrl}
                      target="_blank"
                      className="text-xs text-accent hover:underline"
                      rel="noreferrer"
                    >
                      tx ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub: string;
  tone?: 'warn' | 'danger';
}) {
  const color =
    tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : 'text-text';
  return (
    <div className="card p-5">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`text-3xl font-mono mt-1 ${color}`}>{value}</div>
      <div className="text-xs text-muted mt-1">{sub}</div>
    </div>
  );
}
