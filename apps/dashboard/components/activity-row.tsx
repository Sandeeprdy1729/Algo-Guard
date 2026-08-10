'use client';

import { clsx } from 'clsx';
import { fmtUsdc, relTime, shortAddr } from '@/lib/api';
import type { ReactNode } from 'react';

export interface ActivityTx {
  id: string;
  agentName?: string | null;
  agentAddress?: string | null;
  route: string;
  amountMicroUsdc: number;
  status: string;
  riskScore?: number | null;
  riskReason?: string | null;
  loraUrl?: string | null;
  latencyMs?: number | null;
  createdAt: string;
}

const META: Record<
  string,
  { icon: ReactNode; label: string; verb: string; accent: 'ok' | 'warn' | 'danger' | 'muted' }
> = {
  settled: {
    icon: <CheckIcon />,
    label: 'Payment settled',
    verb: 'Paid',
    accent: 'ok',
  },
  allowed: {
    icon: <CheckIcon />,
    label: 'Payment settled',
    verb: 'Paid',
    accent: 'ok',
  },
  escalated: {
    icon: <ClockIcon />,
    label: 'Human approval required',
    verb: 'Waiting',
    accent: 'warn',
  },
  blocked_policy: {
    icon: <XIcon />,
    label: 'Policy blocked',
    verb: 'Refused',
    accent: 'danger',
  },
  blocked_risk: {
    icon: <XIcon />,
    label: 'Risk blocked',
    verb: 'Refused',
    accent: 'danger',
  },
  reverted: {
    icon: <XIcon />,
    label: 'Reverted',
    verb: 'Reverted',
    accent: 'muted',
  },
};

export function ActivityRow({
  tx,
  fresh = false,
  compact = false,
}: {
  tx: ActivityTx;
  fresh?: boolean;
  compact?: boolean;
}) {
  const meta = META[tx.status] ?? META.reverted;

  return (
    <div
      className={clsx(
        'group relative flex items-start gap-3 py-3 pl-4 pr-3 border-b border-border/60 last:border-b-0',
        'transition-colors duration-200',
        fresh && 'animate-row-in',
      )}
    >
      {/* Left accent stripe — semantic color, 2px wide */}
      <span
        aria-hidden
        className={clsx('absolute left-0 top-2 bottom-2 w-[2px] rounded-r', {
          'bg-ok':     meta.accent === 'ok',
          'bg-warn':   meta.accent === 'warn',
          'bg-danger': meta.accent === 'danger',
          'bg-dim':    meta.accent === 'muted',
        })}
      />

      <div
        className={clsx(
          'flex-none mt-0.5 h-5 w-5 flex items-center justify-center rounded-md',
          {
            'text-ok bg-ok/10':         meta.accent === 'ok',
            'text-warn bg-warn/10':     meta.accent === 'warn',
            'text-danger bg-danger/10': meta.accent === 'danger',
            'text-muted bg-surface-2':  meta.accent === 'muted',
          },
        )}
        aria-hidden
      >
        {meta.icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <div className={clsx('text-2xs font-mono uppercase tracking-widest', {
            'text-ok':     meta.accent === 'ok',
            'text-warn':   meta.accent === 'warn',
            'text-danger': meta.accent === 'danger',
            'text-muted':  meta.accent === 'muted',
          })}>
            {meta.label}
          </div>
          <span className="text-2xs text-dim">•</span>
          <div className="text-2xs text-muted num">{relTime(tx.createdAt)}</div>
          {tx.riskScore != null && !compact && (
            <>
              <span className="text-2xs text-dim">•</span>
              <div className="text-2xs text-muted num">risk {tx.riskScore}</div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 mt-0.5">
          <div className="font-mono text-[13px] text-text truncate">{tx.route}</div>
          <div className="text-[13px] num text-text-2">
            {fmtUsdc(tx.amountMicroUsdc)}
            <span className="text-muted text-2xs ml-1">USDC</span>
          </div>
        </div>

        {tx.riskReason && !compact && (
          <div className="text-2xs text-muted mt-0.5 truncate max-w-[52ch]" title={tx.riskReason}>
            {tx.riskReason}
          </div>
        )}
      </div>

      <div className="flex-none flex flex-col items-end gap-1">
        {tx.agentName && (
          <div className="text-2xs text-text-2 truncate max-w-[16ch]">{tx.agentName}</div>
        )}
        {tx.agentAddress && (
          <div className="text-2xs font-mono text-muted">{shortAddr(tx.agentAddress)}</div>
        )}
        {tx.loraUrl && (
          <a
            href={tx.loraUrl}
            target="_blank"
            rel="noreferrer"
            className="text-2xs font-mono text-accent hover:underline underline-offset-2"
            onClick={(e) => e.stopPropagation()}
          >
            View on Lora ↗
          </a>
        )}
      </div>
    </div>
  );
}

// ── inline icons (14px, 1.5 stroke) ─────────────────────────────────
function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="m2.5 6.5 2.2 2.2L9.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="4.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 3.5V6l1.7 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
