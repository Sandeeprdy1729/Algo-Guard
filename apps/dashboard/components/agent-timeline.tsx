'use client';

/**
 * AgentTimeline
 *
 * Chronological, mixed-source feed of an agent's behavior:
 *   transactions · approvals · security events (freeze/unfreeze/policy)
 *
 * Data comes from GET /api/agents/:id/timeline — one query merges all
 * three sources on the server. This component renders + filters only.
 */

import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { fmtUsdc, relTime } from '@/lib/api';
import { useFetch } from '@/lib/swr';
import { Empty, ErrorBanner, Loading } from '@/components/ui';

type Kind = 'transaction' | 'approval' | 'security';
type Tone = 'success' | 'warn' | 'block' | 'info';

interface Entry {
  kind: Kind;
  id: string;
  at: string;
  summary: string;
  tone: Tone;
  detail: Record<string, unknown>;
}

interface Resp {
  agent: { id: string; name: string; status: string };
  entries: Entry[];
}

const KIND_LABEL: Record<Kind, string> = {
  transaction: 'Transactions',
  approval:    'Approvals',
  security:    'Security',
};

export function AgentTimeline({ agentId }: { agentId: string }) {
  const { data, loading, error, refetch } = useFetch<Resp>(
    agentId ? `/api/agents/${agentId}/timeline?limit=100` : null,
  );
  const [filter, setFilter] = useState<Kind | 'all'>('all');

  const entries = useMemo(() => {
    if (!data) return [];
    return filter === 'all' ? data.entries : data.entries.filter((e) => e.kind === filter);
  }, [data, filter]);

  const counts = useMemo(() => {
    const out: Record<Kind, number> = { transaction: 0, approval: 0, security: 0 };
    for (const e of data?.entries ?? []) out[e.kind]++;
    return out;
  }, [data]);

  if (loading) return <Loading label="Loading timeline" />;
  if (error) {
    return (
      <ErrorBanner
        title="Could not load timeline"
        detail={error.message}
        requestId={error.requestId}
        onRetry={refetch}
      />
    );
  }
  if (!data) return null;

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between px-5 py-4 border-b border-border flex-wrap gap-3">
        <div>
          <div className="sec-label">Behavior timeline</div>
          <div className="text-[13px] text-text mt-0.5">
            Every enforceable action taken on {data.agent.name}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <FilterChip
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            label={`All ${data.entries.length}`}
          />
          {(['transaction', 'approval', 'security'] as Kind[]).map((k) => (
            <FilterChip
              key={k}
              active={filter === k}
              onClick={() => setFilter(k)}
              label={`${KIND_LABEL[k]} ${counts[k]}`}
            />
          ))}
        </div>
      </header>

      {entries.length === 0 ? (
        <div className="p-6"><Empty>No events for this filter.</Empty></div>
      ) : (
        <ol className="relative">
          {/* Left rail — the timeline "spine" */}
          <span
            aria-hidden
            className="absolute left-[27px] top-0 bottom-0 w-px bg-border"
          />
          {entries.map((e) => (
            <TimelineItem key={`${e.kind}:${e.id}`} entry={e} />
          ))}
        </ol>
      )}
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'pill text-2xs font-mono uppercase tracking-widest transition-colors',
        active
          ? 'border-accent/50 bg-accent/10 text-accent'
          : 'border-border text-muted hover:text-text hover:border-border',
      )}
    >
      {label}
    </button>
  );
}

function TimelineItem({ entry }: { entry: Entry }) {
  const dotClass = clsx('flex-none h-3 w-3 rounded-full border-2 border-bg', {
    'bg-ok':     entry.tone === 'success',
    'bg-warn':   entry.tone === 'warn',
    'bg-danger': entry.tone === 'block',
    'bg-muted':  entry.tone === 'info',
  });

  const kindColour = clsx('text-2xs font-mono uppercase tracking-widest', {
    'text-ok':     entry.tone === 'success',
    'text-warn':   entry.tone === 'warn',
    'text-danger': entry.tone === 'block',
    'text-muted':  entry.tone === 'info',
  });

  return (
    <li className="relative flex items-start gap-4 pl-5 pr-5 py-3 hover:bg-surface-2/40 transition-colors">
      {/* Dot on the spine — spine is at left-[27px], so center this at 27 */}
      <span className="relative z-10 mt-1.5" style={{ marginLeft: 15 }}>
        <span className={dotClass} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={kindColour}>{entry.kind}</span>
          <span className="text-2xs text-dim">•</span>
          <span className="text-2xs text-muted num">{relTime(entry.at)}</span>
        </div>
        <div className="text-[13px] text-text mt-0.5 truncate" title={entry.summary}>
          {entry.summary}
        </div>
        <DetailStrip entry={entry} />
      </div>
    </li>
  );
}

function DetailStrip({ entry }: { entry: Entry }) {
  const d = entry.detail;
  const parts: string[] = [];
  if (typeof d.riskScore === 'number') parts.push(`risk ${d.riskScore}`);
  if (typeof d.actor === 'string' && d.actor) parts.push(`actor ${d.actor}`);
  if (typeof d.reason === 'string' && d.reason) parts.push(d.reason);
  if (typeof d.amountMicroUsdc === 'number' && entry.kind === 'approval') {
    parts.push(fmtUsdc(d.amountMicroUsdc));
  }
  if (parts.length === 0) return null;
  return (
    <div className="text-2xs text-muted mt-0.5 font-mono truncate">
      {parts.join(' · ')}
    </div>
  );
}
