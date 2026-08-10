'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, ApiError, fmtUsdc, shortAddr } from '@/lib/api';
import { useEventStream } from '@/lib/stream';
import { Empty, ErrorBanner, Loading, Progress, StatusPill } from '@/components/ui';
import { ActivityRow, type ActivityTx } from '@/components/activity-row';
import { ChainVerification } from '@/components/chain-verification';

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
  spend: { dailySpentMicroUsdc: number; monthlySpentMicroUsdc?: number };
}

const FRESH_MS = 900;

export default function Overview() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [txns, setTxns] = useState<ActivityTx[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const freshTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEventStream({
    transaction: (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as ActivityTx;
        setTxns((prev) => {
          const rest = (prev ?? []).filter((t) => t.id !== data.id);
          return [data, ...rest].slice(0, 40);
        });
        setFresh((prev) => new Set(prev).add(data.id));
        clearTimeout(freshTimers.current[data.id]);
        freshTimers.current[data.id] = setTimeout(() => {
          setFresh((prev) => {
            const next = new Set(prev);
            next.delete(data.id);
            return next;
          });
        }, FRESH_MS);
      } catch {}
    },
    approval: () => void load(),
  });

  const load = async () => {
    try {
      setError(null);
      const [a, t] = await Promise.all([
        apiGet<{ agents: Agent[] }>('/api/agents'),
        apiGet<{ transactions: ActivityTx[] }>('/api/audit?limit=30'),
      ]);
      setAgents(a.agents);
      setTxns(t.transactions);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), { status: 0 }));
    }
  };

  useEffect(() => {
    void load();
    return () => {
      Object.values(freshTimers.current).forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  if (!agents || !txns) return <Loading label="Loading overview" />;

  const hero = agents[0]; // primary agent for the hero summary
  const totalDaily   = agents.reduce((s, a) => s + (a.spend?.dailySpentMicroUsdc ?? 0), 0);
  const totalCap     = agents.reduce((s, a) => s + (a.policy?.dailyCapMicroUsdc ?? 0), 0);
  const pending      = txns.filter((t) => t.status === 'escalated').length;
  const blocked      = txns.filter((t) => t.status.startsWith('blocked')).length;
  const settled24h   = txns.filter((t) => t.status === 'settled').length;

  return (
    <div className="space-y-8">
      {/* ── header ─────────────────────────────────────────────── */}
      <header className="flex items-end justify-between gap-6">
        <div>
          <div className="sec-label">Control plane</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tightest text-text">
            Autonomous Payment Governance
          </h1>
          <p className="mt-1 text-sm text-text-2 max-w-[52ch]">
            On-chain policy enforcement, AI risk scoring, and human-in-the-loop controls for
            every request your agents make.
          </p>
        </div>
      </header>

      {/* ── hero: primary agent spend, four secondary stats ───── */}
      <section className="grid grid-cols-12 gap-4">
        {/* Left: dominant spend gauge */}
        <div className="card col-span-12 lg:col-span-7 p-6 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="sec-label">Spent today · {hero?.name ?? 'agent'}</div>
            {hero && <StatusPill status={hero.status} />}
          </div>

          <div className="mt-3 flex items-end gap-3">
            <div className="text-5xl font-semibold tracking-tightest num text-text">
              {fmtUsdc(hero?.spend.dailySpentMicroUsdc ?? 0)}
            </div>
            <div className="pb-1.5 text-lg num text-muted">
              / {fmtUsdc(hero?.policy?.dailyCapMicroUsdc ?? 0)}
            </div>
          </div>

          <div className="mt-4">
            <Progress
              value={hero?.spend.dailySpentMicroUsdc ?? 0}
              max={hero?.policy?.dailyCapMicroUsdc ?? 0}
              showLegend
            />
          </div>

          <dl className="mt-6 grid grid-cols-3 gap-6">
            <MetaCell
              label="Remaining"
              value={fmtUsdc(
                Math.max(
                  0,
                  (hero?.policy?.dailyCapMicroUsdc ?? 0) - (hero?.spend.dailySpentMicroUsdc ?? 0),
                ),
              )}
            />
            <MetaCell
              label="Human approval ≥"
              value={fmtUsdc(hero?.policy?.humanThresholdMicroUsdc ?? 0)}
            />
            <MetaCell
              label="Allowed routes"
              value={String((hero?.policy?.allowedRoutes ?? []).length)}
            />
          </dl>

          {hero && (
            <div className="mt-6 pt-4 border-t border-border flex items-center gap-3">
              <span className="pill border-border text-muted font-mono">
                {shortAddr(hero.algoAddress)}
              </span>
              <a
                href={`/agents/${hero.id}`}
                className="text-2xs font-mono text-accent uppercase tracking-widest hover:underline underline-offset-2"
              >
                View agent →
              </a>
            </div>
          )}
        </div>

        {/* Right column: four smaller stats */}
        <div className="col-span-12 lg:col-span-5 grid grid-cols-2 gap-4">
          <Stat label="Agents"     value={agents.length}       sub="under policy" />
          <Stat label="Settled"    value={settled24h}          sub="last 30 requests" tone={settled24h > 0 ? 'ok' : undefined} />
          <Stat label="Escalated"  value={pending}             sub="pending human"    tone={pending > 0 ? 'warn' : undefined} />
          <Stat label="Blocked"    value={blocked}             sub="last 30 requests" tone={blocked > 0 ? 'danger' : undefined} />
        </div>
      </section>

      {/* ── activity + chain verification ──────────────────────── */}
      <section className="grid grid-cols-12 gap-4">
        <div className="card col-span-12 lg:col-span-8 overflow-hidden">
          <header className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <div className="sec-label">Live activity</div>
              <div className="text-[13px] text-text mt-0.5">
                Real-time policy + payment events
              </div>
            </div>
            <a
              href="/audit"
              className="text-2xs font-mono uppercase tracking-widest text-accent hover:underline underline-offset-2"
            >
              Open audit →
            </a>
          </header>

          {txns.length === 0 ? (
            <div className="p-6">
              <Empty>Idle — awaiting agent traffic.</Empty>
            </div>
          ) : (
            <div>
              {txns.slice(0, 12).map((t) => (
                <ActivityRow key={t.id} tx={t} fresh={fresh.has(t.id)} />
              ))}
            </div>
          )}
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-4">
          <ChainVerification />

          {agents.length > 1 && (
            <div className="card p-5">
              <div className="sec-label mb-3">Other agents</div>
              <ul className="space-y-3">
                {agents.slice(1).map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <a href={`/agents/${a.id}`} className="text-[13px] text-text hover:text-accent transition-colors">
                        {a.name}
                      </a>
                      <div className="text-2xs font-mono text-muted truncate">
                        {shortAddr(a.algoAddress)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xs font-mono num text-text-2">
                        {fmtUsdc(a.spend.dailySpentMicroUsdc)}
                      </div>
                      <div className="text-2xs font-mono text-muted num">
                        / {fmtUsdc(a.policy?.dailyCapMicroUsdc ?? 0)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
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
  tone?: 'ok' | 'warn' | 'danger';
}) {
  const color =
    tone === 'ok' ? 'text-ok' :
    tone === 'warn' ? 'text-warn' :
    tone === 'danger' ? 'text-danger' :
    'text-text';
  return (
    <div className="card p-4 card-hover">
      <div className="sec-label">{label}</div>
      <div className={`mt-1.5 text-3xl font-semibold tracking-tightest num ${color}`}>
        {value}
      </div>
      <div className="text-2xs text-muted mt-1">{sub}</div>
    </div>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="sec-label">{label}</div>
      <div className="mt-1 text-[15px] num text-text-2">{value}</div>
    </div>
  );
}
