'use client';

import { useMemo, useState } from 'react';
import { fmtUsdc, relTime, shortAddr } from '@/lib/api';
import { useFetch } from '@/lib/swr';
import { Empty, ErrorBanner, Loading, StatusPill } from '@/components/ui';

interface Tx {
  id: string;
  agentName?: string;
  agentAddress?: string;
  route: string;
  amountMicroUsdc: number;
  status: string;
  riskScore: number | null;
  riskReason: string | null;
  loraUrl: string | null;
  latencyMs: number | null;
  createdAt: string;
}

const FILTERS = ['', 'settled', 'escalated', 'blocked_policy', 'blocked_risk'] as const;

export default function AuditPage() {
  const [filter, setFilter] = useState<string>('');
  const path = useMemo(
    () => `/api/audit?limit=200${filter ? `&status=${filter}` : ''}`,
    [filter]
  );
  const { data, loading, error, refetch } = useFetch<{ transactions: Tx[] }>(path);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Audit</h1>
        <div className="ml-auto flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f || 'all'}
              onClick={() => setFilter(f)}
              className={
                'text-xs px-3 py-1 rounded border ' +
                (filter === f
                  ? 'border-accent text-accent bg-accent/10'
                  : 'border-border text-muted hover:border-muted')
              }
            >
              {f || 'all'}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <ErrorBanner
          title="Could not load audit"
          detail={error.message}
          requestId={error.requestId}
          onRetry={refetch}
        />
      )}
      {loading && <Loading label="Loading audit trail…" />}
      {data && (
        <div className="card">
          {data.transactions.length === 0 ? (
            <Empty>No transactions match this filter.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted text-xs uppercase">
                <tr>
                  <th className="p-3">When</th>
                  <th className="p-3">Agent</th>
                  <th className="p-3">Route</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Risk</th>
                  <th className="p-3">Latency</th>
                  <th className="p-3">Chain</th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="p-3 text-xs text-muted whitespace-nowrap">
                      {relTime(t.createdAt)}
                    </td>
                    <td className="p-3">
                      <div>{t.agentName ?? '—'}</div>
                      <div className="text-xs text-muted font-mono">
                        {t.agentAddress ? shortAddr(t.agentAddress) : ''}
                      </div>
                    </td>
                    <td className="p-3 font-mono text-xs">{t.route}</td>
                    <td className="p-3 font-mono">{fmtUsdc(t.amountMicroUsdc)}</td>
                    <td className="p-3">
                      <StatusPill status={t.status} />
                    </td>
                    <td className="p-3 text-xs">
                      {t.riskScore != null ? t.riskScore : '—'}
                      {t.riskReason && (
                        <div className="text-muted text-[10px] max-w-xs truncate" title={t.riskReason}>
                          {t.riskReason}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-xs text-muted">
                      {t.latencyMs != null ? `${t.latencyMs} ms` : '—'}
                    </td>
                    <td className="p-3 text-xs">
                      {t.loraUrl ? (
                        <a
                          href={t.loraUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent hover:underline"
                        >
                          view ↗
                        </a>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
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
