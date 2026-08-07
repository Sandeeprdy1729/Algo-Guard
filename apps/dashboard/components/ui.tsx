'use client';

import { clsx } from 'clsx';

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-10 text-center text-muted text-sm border border-dashed border-border rounded-lg">
      {children}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="p-6 text-muted text-sm flex items-center gap-3">
      <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse" />
      {label}
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
    <div className="rounded-lg border border-danger/50 bg-danger/10 p-4 text-sm space-y-1">
      <div className="text-danger font-medium">{title}</div>
      {detail && <div className="text-muted">{detail}</div>}
      {requestId && (
        <div className="text-muted font-mono text-xs">
          requestId: {requestId}
        </div>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 px-3 py-1 border border-danger/60 rounded text-danger hover:bg-danger/20 text-xs"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function Pill({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'accent' | 'warn' | 'danger';
}) {
  return (
    <span
      className={clsx('pill', {
        'border-border text-muted': tone === 'muted',
        'border-accent/60 text-accent bg-accent/10': tone === 'accent',
        'border-warn/60 text-warn bg-warn/10': tone === 'warn',
        'border-danger/60 text-danger bg-danger/10': tone === 'danger',
      })}
    >
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, 'muted' | 'accent' | 'warn' | 'danger'> = {
  settled: 'accent',
  allowed: 'accent',
  escalated: 'warn',
  blocked_policy: 'danger',
  blocked_risk: 'danger',
  reverted: 'muted',
  pending: 'warn',
  approved: 'accent',
  denied: 'danger',
  expired: 'muted',
  active: 'accent',
  frozen: 'danger',
};

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={STATUS_TONE[status] ?? 'muted'}>{status}</Pill>;
}
