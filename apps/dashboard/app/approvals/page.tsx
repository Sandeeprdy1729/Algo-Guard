'use client';

import { useState } from 'react';
import { ApiError, apiPost, fmtUsdc, relTime, shortAddr } from '@/lib/api';
import { useFetch } from '@/lib/swr';
import { useEventStream } from '@/lib/stream';
import { Empty, ErrorBanner, Loading, Pill } from '@/components/ui';

interface Approval {
  id: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  transaction: {
    route: string;
    amountMicroUsdc: number;
    agentName: string;
    agentAddress: string;
    riskScore: number | null;
    riskReason: string | null;
  };
}

export default function ApprovalsPage() {
  const { data, loading, error, refetch } = useFetch<{ approvals: Approval[] }>(
    '/api/approvals?status=pending'
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [actError, setActError] = useState<ApiError | null>(null);

  useEventStream({
    approval: () => void refetch(),
    transaction: () => void refetch(),
  });

  const act = async (id: string, decision: 'approved' | 'denied') => {
    setBusy(id);
    setActError(null);
    try {
      await apiPost(`/api/approvals/${id}/decision`, { decision });
      await refetch();
    } catch (err) {
      setActError(err instanceof ApiError ? err : new ApiError(String(err), { status: 0 }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Human approvals</h1>
        <p className="text-sm text-muted mt-1">
          Payment requests above the agent's escalation threshold, or flagged by risk score.
          Approve to release; deny to reject.
        </p>
      </div>

      {error && (
        <ErrorBanner
          title="Could not load approvals"
          detail={error.message}
          requestId={error.requestId}
          onRetry={refetch}
        />
      )}
      {actError && (
        <ErrorBanner title="Action failed" detail={actError.message} requestId={actError.requestId} />
      )}
      {loading && <Loading label="Loading queue…" />}

      {data && (data.approvals.length === 0 ? (
        <Empty>Queue is empty — no pending approvals.</Empty>
      ) : (
        <ul className="space-y-4">
          {data.approvals.map((a) => (
            <li key={a.id} className="card p-5 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <Pill tone="warn">pending</Pill>
                <span className="font-mono text-xs text-muted">{a.transaction.route}</span>
                <span className="font-mono">{fmtUsdc(a.transaction.amountMicroUsdc)}</span>
                <span className="text-xs text-muted">
                  agent {a.transaction.agentName} · {shortAddr(a.transaction.agentAddress)}
                </span>
                <span className="ml-auto text-xs text-muted">
                  expires {relTime(a.expiresAt)}
                </span>
              </div>

              {a.transaction.riskScore != null && (
                <div className="text-xs text-muted">
                  risk {a.transaction.riskScore}
                  {a.transaction.riskReason ? ` — ${a.transaction.riskReason}` : ''}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  disabled={busy === a.id}
                  onClick={() => act(a.id, 'approved')}
                  className="px-4 py-2 bg-accent text-bg font-medium rounded disabled:opacity-40"
                >
                  {busy === a.id ? 'Working…' : 'Approve'}
                </button>
                <button
                  disabled={busy === a.id}
                  onClick={() => act(a.id, 'denied')}
                  className="px-4 py-2 border border-danger text-danger rounded hover:bg-danger/10 disabled:opacity-40"
                >
                  Deny
                </button>
              </div>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}
