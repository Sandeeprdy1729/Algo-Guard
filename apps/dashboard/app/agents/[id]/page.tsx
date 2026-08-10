'use client';

export const dynamic = 'force-dynamic';

import { useParams } from 'next/navigation';
import { apiPost, fmtUsdc } from '@/lib/api';
import { useFetch } from '@/lib/swr';
import {
  Empty,
  ErrorBanner,
  Loading,
  Progress,
  StatusPill,
} from '@/components/ui';
import { ActivityRow, type ActivityTx } from '@/components/activity-row';
import { PolicyEvaluation } from '@/components/policy-evaluation';
import { AgentTimeline } from '@/components/agent-timeline';

interface Detail {
  id: string;
  name: string;
  algoAddress: string;
  status: 'active' | 'frozen';
  policy: null | {
    dailyCapMicroUsdc: number;
    monthlyCapMicroUsdc: number;
    humanThresholdMicroUsdc: number;
    allowedRoutes: string[];
    riskThreshold: number;
  };
  transactions: ActivityTx[];
  spend: { dailySpentMicroUsdc: number; monthlySpentMicroUsdc: number };
}

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, refetch } = useFetch<Detail>(
    id ? `/api/agents/${id}` : null,
  );

  if (loading) return <Loading label="Loading agent" />;
  if (error)
    return (
      <ErrorBanner
        title="Could not load agent"
        detail={error.message}
        requestId={error.requestId}
        onRetry={refetch}
      />
    );
  if (!data) return null;

  const dailyRemaining = Math.max(
    0,
    (data.policy?.dailyCapMicroUsdc ?? 0) - data.spend.dailySpentMicroUsdc,
  );
  const allowedRoutes = data.policy?.allowedRoutes ?? [];

  return (
    <div className="space-y-8">
      {/* ── identity header ─────────────────────────────────── */}
      <header className="flex items-start justify-between gap-6 flex-wrap">
        <div className="min-w-0">
          <div className="sec-label">Agent profile</div>
          <div className="mt-1 flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tightest text-text">
              {data.name}
            </h1>
            <StatusPill status={data.status} />
          </div>
          <div className="mt-2 font-mono text-2xs text-muted break-all">
            {data.algoAddress}
          </div>
        </div>

        {/* Emergency kill-switch — deliberately visible and unambiguous.
            The button style hardens (fill, not outline) so a frozen
            agent's page carries a clear "recovery" affordance. */}
        <KillSwitch
          status={data.status}
          onFreeze={async () => {
            await apiPost(`/api/agents/${id}/freeze`, { actor: 'dashboard' });
            await refetch();
          }}
          onUnfreeze={async () => {
            await apiPost(`/api/agents/${id}/unfreeze`, { actor: 'dashboard' });
            await refetch();
          }}
        />
      </header>

      {data.status === 'frozen' && (
        <div className="rounded-xl border border-danger/40 bg-danger/5 p-4 flex items-start gap-3">
          <span aria-hidden className="h-2 w-2 rounded-full bg-danger mt-1.5 flex-none" />
          <div className="flex-1">
            <div className="text-danger font-medium text-sm">
              Agent is frozen
            </div>
            <div className="text-2xs text-text-2 mt-0.5 leading-relaxed">
              Every x402 request from this agent is refused before the payment
              handshake reaches the resource server. Unfreeze to resume.
            </div>
          </div>
        </div>
      )}

      {/* ── policy enforcement panel ────────────────────────── */}
      <section className="card p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="sec-label">Policy enforcement</div>
          <span className="text-2xs font-mono text-muted uppercase tracking-widest">
            enforced on chain
          </span>
        </div>

        <div className="grid md:grid-cols-4 gap-6">
          <PolicyCell
            label="Daily cap"
            main={fmtUsdc(data.policy?.dailyCapMicroUsdc ?? 0)}
            sub={`spent ${fmtUsdc(data.spend.dailySpentMicroUsdc)}`}
            progress={{
              value: data.spend.dailySpentMicroUsdc,
              max: data.policy?.dailyCapMicroUsdc ?? 0,
            }}
          />
          <PolicyCell
            label="Monthly cap"
            main={fmtUsdc(data.policy?.monthlyCapMicroUsdc ?? 0)}
            sub={`spent ${fmtUsdc(data.spend.monthlySpentMicroUsdc)}`}
            progress={{
              value: data.spend.monthlySpentMicroUsdc,
              max: data.policy?.monthlyCapMicroUsdc ?? 0,
            }}
          />
          <PolicyCell
            label="Human approval"
            main={`≥ ${fmtUsdc(data.policy?.humanThresholdMicroUsdc ?? 0)}`}
            sub="per request"
          />
          <PolicyCell
            label="Risk threshold"
            main={String(data.policy?.riskThreshold ?? '—')}
            sub="escalate on higher"
          />
        </div>

        <div className="rule" />

        <div>
          <div className="sec-label mb-2">Allowed routes</div>
          {allowedRoutes.length === 0 ? (
            <div className="text-2xs text-muted">
              No routes allow-listed — every request will be refused.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {allowedRoutes.map((r) => (
                <span
                  key={r}
                  className="pill border-ok/30 text-ok bg-ok/5 font-mono normal-case tracking-normal"
                >
                  {r}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="text-2xs font-mono text-muted">
            Remaining today · <span className="text-text-2">{fmtUsdc(dailyRemaining)}</span>
          </div>
          <a
            href="/policies"
            className="text-2xs font-mono text-accent uppercase tracking-widest hover:underline underline-offset-2"
          >
            Edit policy →
          </a>
        </div>
      </section>

      {/* ── policy simulator ────────────────────────────────── */}
      {allowedRoutes.length > 0 && (
        <PolicyEvaluation agentId={id} availableRoutes={allowedRoutes} />
      )}

      {/* ── behavior timeline ───────────────────────────────── */}
      <AgentTimeline agentId={id} />

      {/* ── recent activity ─────────────────────────────────── */}
      <section className="card overflow-hidden">
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <div className="sec-label">Recent activity</div>
            <div className="text-[13px] text-text mt-0.5">Last {data.transactions.length} requests seen by policy</div>
          </div>
          <a
            href="/audit"
            className="text-2xs font-mono uppercase tracking-widest text-accent hover:underline underline-offset-2"
          >
            Full audit →
          </a>
        </header>

        {data.transactions.length === 0 ? (
          <div className="p-6"><Empty>No traffic yet.</Empty></div>
        ) : (
          <div>
            {data.transactions.slice(0, 20).map((t) => (
              <ActivityRow
                key={t.id}
                tx={{ ...t, agentName: data.name, agentAddress: data.algoAddress }}
                compact
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function KillSwitch({
  status,
  onFreeze,
  onUnfreeze,
}: {
  status: 'active' | 'frozen';
  onFreeze: () => Promise<void>;
  onUnfreeze: () => Promise<void>;
}) {
  if (status === 'frozen') {
    return (
      <button
        onClick={onUnfreeze}
        className="btn btn-ok"
        title="Resume x402 payments from this agent"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-ok" />
        Unfreeze agent
      </button>
    );
  }
  return (
    <button
      onClick={async () => {
        if (typeof window !== 'undefined' && !window.confirm(
          'Freeze this agent? Every x402 request will be refused until unfrozen.'
        )) return;
        await onFreeze();
      }}
      className="btn btn-danger"
      title="Emergency stop — refuse all future x402 requests from this agent"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-danger" />
      Emergency freeze
    </button>
  );
}

function PolicyCell({
  label,
  main,
  sub,
  progress,
}: {
  label: string;
  main: string;
  sub: string;
  progress?: { value: number; max: number };
}) {
  return (
    <div>
      <div className="sec-label">{label}</div>
      <div className="mt-1 text-xl font-semibold num tracking-tightest text-text">{main}</div>
      <div className="text-2xs text-muted mt-0.5">{sub}</div>
      {progress && progress.max > 0 && (
        <div className="mt-2.5">
          <Progress value={progress.value} max={progress.max} />
        </div>
      )}
    </div>
  );
}
