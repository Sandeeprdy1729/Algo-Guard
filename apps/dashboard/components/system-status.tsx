'use client';

import { useEventStream } from '@/lib/stream';
import { clsx } from 'clsx';

export function SystemStatus() {
  const { connected } = useEventStream({});
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-2 text-2xs font-mono uppercase tracking-wider',
        connected ? 'text-ok' : 'text-muted',
      )}
      title={connected ? 'live stream connected' : 'reconnecting'}
    >
      <span className={connected ? 'dot-live' : 'dot-idle'} />
      {connected ? 'All systems operational' : 'Reconnecting'}
    </span>
  );
}
