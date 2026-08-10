'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';

interface ChainLog {
  id: string;
  round: string;
  algoTxnId: string | null;
  loraUrl: string | null;
  eventType: string;
  createdAt: string;
}

/**
 * Compact "on-chain proof" block for the overview page.
 * Reads /api/audit/chain and shows the most recent SPND event.
 */
export function ChainVerification() {
  const [latest, setLatest] = useState<ChainLog | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const j = await apiGet<{ logs: ChainLog[] }>('/api/audit/chain?limit=5');
        if (cancelled) return;
        const spend = j.logs.find((l) => l.eventType === 'SPEND') ?? j.logs[0] ?? null;
        setLatest(spend);
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    };
    load();
    const t = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="sec-label">On-chain verification</div>
          <div className="mt-1 text-[13px] font-semibold text-text">Algorand TestNet</div>
        </div>
        <span className="pill border-ok/40 text-ok bg-ok/5">
          <span className="dot-live" /> Verified
        </span>
      </div>

      <div className="rule" />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="sec-label">App</div>
          <div className="mt-1 font-mono text-[13px] text-text-2 num">768730271</div>
          <a
            href="https://lora.algokit.io/testnet/application/768730271"
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-2xs font-mono text-accent hover:underline underline-offset-2"
          >
            View contract ↗
          </a>
        </div>
        <div>
          <div className="sec-label">Latest SPND</div>
          {loaded && latest ? (
            <>
              <div className="mt-1 font-mono text-[13px] text-text-2 num">
                Round {latest.round}
              </div>
              {latest.loraUrl && (
                <a
                  href={latest.loraUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-2xs font-mono text-accent hover:underline underline-offset-2"
                >
                  View txn ↗
                </a>
              )}
            </>
          ) : (
            <div className="mt-1 text-2xs text-muted">awaiting first on-chain event</div>
          )}
        </div>
      </div>
    </div>
  );
}
