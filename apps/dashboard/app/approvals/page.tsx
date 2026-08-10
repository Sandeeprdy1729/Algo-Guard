'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { ApiError, apiPost, fmtUsdc, shortAddr } from '@/lib/api';
import { useFetch } from '@/lib/swr';
import { useEventStream } from '@/lib/stream';
import { Empty, ErrorBanner, Loading } from '@/components/ui';

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
    '/api/approvals?status=pending',
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [actError, setActError] = useState<ApiError | null>(null);

  useEventStream({
    approval:    () => void refetch(),
    transaction: () => void refetch(),
  });

  const act = async (id: string, decision: 'approved' | 'denied') => {
    setBusy(id); setActError(null);
    try {
      await apiPost(`/api/approvals/${id}/decision`, { decision });
      await refetch();
    } catch (err) {
      setActError(err instanceof ApiError ? err : new ApiError(String(err), { status: 0 }));
    } finally { setBusy(null); }
  };

  const queue = data?.approvals ?? [];

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="sec-label">Priority queue</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tightest text-text">
            Human approvals
          </h1>
          <p className="mt-1 text-sm text-text-2 max-w-[60ch]">
            Payment requests above the agent's escalation threshold or flagged by risk
            scoring. Approve to release the payment; deny to reject it permanently.
          </p>
        </div>
        <div className="pill border-warn/40 text-warn bg-warn/5">
          <span className="h-1.5 w-1.5 rounded-full bg-warn" />
          {queue.length} {queue.length === 1 ? 'awaiting' : 'awaiting'}
        </div>
      </header>

      {error && (
        <ErrorBanner title="Could not load approvals" detail={error.message} requestId={error.requestId} onRetry={refetch} />
      )}
      {actError && (
        <ErrorBanner title="Action failed" detail={actError.message} requestId={actError.requestId} />
      )}
      {loading && <Loading label="Loading queue" />}

      {data && (queue.length === 0 ? (
        <Empty>Queue is empty — no requests are waiting on a human.</Empty>
      ) : (
        <ul className="space-y-4">
          {queue.map((a) => (
            <ApprovalCard
              key={a.id}
              approval={a}
              busy={busy === a.id}
              onApprove={() => act(a.id, 'approved')}
              onDeny={() => act(a.id, 'denied')}
            />
          ))}
        </ul>
      ))}
    </div>
  );
}

function ApprovalCard({
  approval,
  busy,
  onApprove,
  onDeny,
}: {
  approval: Approval;
  busy: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const routeParts = approval.transaction.route.split(' ');
  const method = routeParts[0] ?? '';
  const path = routeParts.slice(1).join(' ');
  const expiresAt = new Date(approval.expiresAt);
  const now = Date.now();
  const remaining = Math.max(0, expiresAt.getTime() - now);
  const min = Math.floor(remaining / 60_000);
  const sec = Math.floor((remaining % 60_000) / 1_000);

  return (
    <li
      className="card p-6 space-y-5 relative overflow-hidden animate-row-in"
      style={{ borderColor: 'rgba(245,158,11,0.25)' }}
    >
      {/* Priority stripe */}
      <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px] bg-warn" />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="sec-label text-warn">Human approval required</div>
          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <span className="text-xl font-semibold tracking-tightest text-text font-mono">
              {method}
            </span>
            <span className="text-xl font-mono text-text-2">{path}</span>
          </div>
        </div>

        <div className="text-right">
          <div className="sec-label">Amount</div>
          <div className="mt-1 text-2xl font-semibold num tracking-tightest text-text">
            {fmtUsdc(approval.transaction.amountMicroUsdc)}
            <span className="text-muted text-sm ml-1.5 font-mono">USDC</span>
          </div>
        </div>
      </div>

      <div className="rule" />

      <div className="grid md:grid-cols-3 gap-6">
        <ApprovalMeta label="Reason">
          {approval.transaction.riskReason ?? 'Amount exceeds configured human threshold.'}
        </ApprovalMeta>
        <ApprovalMeta label="Agent">
          <div className="text-text text-[13px]">{approval.transaction.agentName}</div>
          <div className="text-2xs font-mono text-muted mt-0.5">
            {shortAddr(approval.transaction.agentAddress)}
          </div>
        </ApprovalMeta>
        <ApprovalMeta label="Expires">
          <span className="font-mono num text-text-2">
            {remaining > 0 ? `${min}m ${sec.toString().padStart(2, '0')}s` : 'expired'}
          </span>
          {approval.transaction.riskScore != null && (
            <div className="text-2xs text-muted mt-0.5 font-mono">
              risk score {approval.transaction.riskScore}
            </div>
          )}
        </ApprovalMeta>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <button
          disabled={busy}
          onClick={onApprove}
          className="btn btn-ok"
        >
          {busy ? 'Working…' : 'Approve'}
        </button>
        <button
          disabled={busy}
          onClick={onDeny}
          className="btn btn-danger"
        >
          Deny
        </button>
      </div>
    </li>
  );
}

function ApprovalMeta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="sec-label">{label}</div>
      <div className="mt-1 text-[13px] text-text-2 leading-snug">{children}</div>
    </div>
  );
}
