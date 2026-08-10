'use client';

export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
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

const FILTERS: { key: string; label: string; count?: number }[] = [
  { key: '',              label: 'All' },
  { key: 'settled',       label: 'Settled' },
  { key: 'escalated',     label: 'Escalated' },
  { key: 'blocked_policy',label: 'Blocked · Policy' },
  { key: 'blocked_risk',  label: 'Blocked · Risk' },
];

export default function AuditPage() {
  const [filter, setFilter] = useState<string>('');
  const path = useMemo(
    () => `/api/audit?limit=200${filter ? `&status=${filter}` : ''}`,
    [filter],
  );
  const { data, loading, error, refetch } = useFetch<{ transactions: Tx[] }>(path);

  const exportQuery = filter ? `?status=${filter}` : '';
  const csvHref = `/api/audit/export.csv${exportQuery}`;
  const jsonHref = `/api/audit/export.json${exportQuery}`;

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="sec-label">Security console</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tightest text-text">
            Audit trail
          </h1>
          <p className="mt-1 text-sm text-text-2">
            Every request the policy layer saw — settled payments, blocks, escalations. Chain
            transactions link to Lora.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href={csvHref} download className="btn btn-ghost">Download CSV</a>
          <a href={jsonHref} download className="btn btn-ghost text-2xs">JSON</a>
        </div>
      </header>

      {/* Filters */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key || 'all'}
              onClick={() => setFilter(f.key)}
              className={clsx(
                'px-3 py-1.5 text-2xs font-mono uppercase tracking-widest rounded-md border transition-all duration-150',
                active
                  ? 'border-text/30 bg-text/5 text-text'
                  : 'border-border text-muted hover:text-text-2 hover:border-border-2',
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {error && (
        <ErrorBanner title="Could not load audit" detail={error.message} requestId={error.requestId} onRetry={refetch} />
      )}
      {loading && <Loading label="Loading audit trail" />}

      {data && (
        <div className="card overflow-hidden">
          {data.transactions.length === 0 ? (
            <div className="p-6"><Empty>No transactions match this filter.</Empty></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="sec-label px-4 py-3 text-left font-normal">When</th>
                    <th className="sec-label px-4 py-3 text-left font-normal">Agent</th>
                    <th className="sec-label px-4 py-3 text-left font-normal">Route</th>
                    <th className="sec-label px-4 py-3 text-right font-normal">Amount</th>
                    <th className="sec-label px-4 py-3 text-left font-normal">Decision</th>
                    <th className="sec-label px-4 py-3 text-left font-normal">Signal</th>
                    <th className="sec-label px-4 py-3 text-right font-normal">Latency</th>
                    <th className="sec-label px-4 py-3 text-left font-normal">Chain</th>
                  </tr>
                </thead>
                <tbody>
                  {data.transactions.map((t) => (
                    <tr
                      key={t.id}
                      className="border-t border-border/60 hover:bg-surface-2/50 transition-colors duration-150"
                    >
                      <td className="px-4 py-3 text-2xs text-muted whitespace-nowrap num">
                        {relTime(t.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-[13px] text-text">{t.agentName ?? '—'}</div>
                        <div className="text-2xs font-mono text-muted mt-0.5">
                          {t.agentAddress ? shortAddr(t.agentAddress) : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-2xs text-text-2">{t.route}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="text-[13px] num text-text">{fmtUsdc(t.amountMicroUsdc)}</div>
                        <div className="text-2xs font-mono text-muted">USDC</div>
                      </td>
                      <td className="px-4 py-3"><StatusPill status={t.status} /></td>
                      <td className="px-4 py-3 max-w-[26ch]">
                        {t.riskScore != null ? (
                          <>
                            <div className="text-2xs font-mono num text-text-2">risk {t.riskScore}</div>
                            {t.riskReason && (
                              <div
                                className="text-2xs text-muted mt-0.5 truncate"
                                title={t.riskReason}
                              >
                                {t.riskReason}
                              </div>
                            )}
                          </>
                        ) : t.riskReason ? (
                          <div className="text-2xs text-muted truncate" title={t.riskReason}>
                            {t.riskReason}
                          </div>
                        ) : (
                          <span className="text-2xs text-dim">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-2xs font-mono text-muted num">
                        {t.latencyMs != null ? `${t.latencyMs} ms` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {t.loraUrl ? (
                          <a
                            href={t.loraUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-2xs font-mono text-accent hover:underline underline-offset-2"
                          >
                            View on Lora ↗
                          </a>
                        ) : (
                          <span className="text-2xs text-dim">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
