'use client';

import { clsx } from 'clsx';
import type { ReactNode } from 'react';

// ── Loading / empty / error ─────────────────────────────────────────

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-muted text-sm py-6">
      <span className="dot-idle animate-pulse-slow" />
      <span className="font-mono uppercase text-2xs tracking-widest">{label}</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="p-10 text-center text-muted text-sm border border-dashed border-border rounded-xl">
      {children}
    </div>
  );
}

export function ErrorBanner({
  title,
  detail,
  requestId,
  onRetry,
}: {
  title: string;
  detail?: string;
  requestId?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm space-y-1.5">
      <div className="flex items-center gap-2 text-danger font-medium">
        <span className="h-1.5 w-1.5 rounded-full bg-danger" />
        {title}
      </div>
      {detail && <div className="text-text-2 leading-relaxed">{detail}</div>}
      {requestId && (
        <div className="text-muted font-mono text-2xs">requestId: {requestId}</div>
      )}
      {onRetry && (
        <button onClick={onRetry} className="btn btn-danger mt-2">
          Retry
        </button>
      )}
    </div>
  );
}

// ── Skeletons for row-shaped loading. ───────────────────────────────

export function SkeletonRow({ cols = 5 }: { cols?: number }) {
  return (
    <tr className="border-t border-border">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="p-3">
          <div
            className="h-3 rounded bg-surface-2 animate-pulse-slow"
            style={{ width: `${40 + ((i * 17) % 40)}%` }}
          />
        </td>
      ))}
    </tr>
  );
}

// ── Pills / status ─────────────────────────────────────────────────

export type Tone = 'muted' | 'accent' | 'ok' | 'warn' | 'danger';

export function Pill({
  children,
  tone = 'muted',
  dot = false,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
}) {
  return (
    <span
      className={clsx('pill', {
        'border-border text-muted': tone === 'muted',
        'border-accent/40 text-accent bg-accent/5': tone === 'accent',
        'border-ok/40 text-ok bg-ok/5': tone === 'ok',
        'border-warn/40 text-warn bg-warn/5': tone === 'warn',
        'border-danger/40 text-danger bg-danger/5': tone === 'danger',
      })}
    >
      {dot && (
        <span
          className={clsx('h-1 w-1 rounded-full', {
            'bg-muted':  tone === 'muted',
            'bg-accent': tone === 'accent',
            'bg-ok':     tone === 'ok',
            'bg-warn':   tone === 'warn',
            'bg-danger': tone === 'danger',
          })}
        />
      )}
      {children}
    </span>
  );
}

// Map every transaction / approval status → the tone we display.
const STATUS_TONE: Record<string, Tone> = {
  settled:        'ok',
  allowed:        'ok',
  approved:       'ok',
  active:         'ok',
  escalated:      'warn',
  pending:        'warn',
  blocked_policy: 'danger',
  blocked_risk:   'danger',
  denied:         'danger',
  frozen:         'danger',
  reverted:       'muted',
  expired:        'muted',
};

const STATUS_LABEL: Record<string, string> = {
  settled:        'Settled',
  allowed:        'Allowed',
  approved:       'Approved',
  active:         'Active',
  escalated:      'Escalated',
  pending:        'Pending',
  blocked_policy: 'Blocked · Policy',
  blocked_risk:   'Blocked · Risk',
  denied:         'Denied',
  frozen:         'Frozen',
  reverted:       'Reverted',
  expired:        'Expired',
};

export function StatusPill({ status }: { status: string }) {
  return (
    <Pill tone={STATUS_TONE[status] ?? 'muted'} dot>
      {STATUS_LABEL[status] ?? status}
    </Pill>
  );
}

// ── Progress track ─────────────────────────────────────────────────

export function Progress({
  value,
  max,
  tone = 'ok',
  showLegend = false,
}: {
  value: number;
  max: number;
  tone?: 'ok' | 'warn' | 'danger';
  showLegend?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  // Auto-escalate tone as the bar fills.
  const autoTone: 'ok' | 'warn' | 'danger' =
    pct >= 95 ? 'danger' : pct >= 75 ? 'warn' : tone;

  const fill =
    autoTone === 'danger'
      ? 'bg-danger'
      : autoTone === 'warn'
        ? 'bg-warn'
        : 'bg-ok';

  return (
    <div className="w-full">
      <div className="track">
        <div className={clsx('track-fill', fill)} style={{ width: `${pct}%` }} />
      </div>
      {showLegend && (
        <div className="flex justify-between mt-1.5 text-2xs font-mono text-muted uppercase tracking-widest">
          <span>{pct.toFixed(0)}% used</span>
          <span>{(100 - pct).toFixed(0)}% remaining</span>
        </div>
      )}
    </div>
  );
}
