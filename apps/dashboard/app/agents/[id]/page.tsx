'use client';

import { useParams } from 'next/navigation';
import { apiPost, fmtUsdc, relTime, shortAddr } from '@/lib/api';
import { useFetch } from '@/lib/swr';
import { Empty, ErrorBanner, Loading, Pill, StatusPill } from '@/components/ui';

interface Detail {
  id: string;
  name: string;
  algoAddress: string;
  status: string;
  policy: null | {
    dailyCapMicroUsdc: number;
    monthlyCapMicroUsdc: number;
    humanThresholdMicroUsdc: number;
    allowedRoutes: string[];
    riskThreshold: number;
  };
  transactions: {
    id: string;
    route: string;
    amountMicroUsdc: number;
    status: string;
    riskScore: number | null;
    riskReason: string | null;
    algoTxnId: string | null;
    createdAt: string;
  }[];
  spend: { dailySpentMicroUsdc: number; monthlySpentMicroUsdc: number };
}

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, refetch } = useFetch<Detail>(id ? `/api/agents/${id}` : null);

  if (loading) return <Loading label="Loading agent…" />;
  if (error) {
    return (
      <ErrorBanner
        title="Could not load agent"
        detail={error.message}
        requestId={error.requestId}
        onRetry={refetch}
      />
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{data.name}</h1>
        <Pill>{shortAddr(data.algoAddress)}</Pill>
        <StatusPill status={data.status} />
        <div className="ml-auto flex gap-2">
          {data.status === 'active' ? (
            <button
              onClick={async () => {
                await apiPost(`/api/agents/${id}/freeze`, {});
                await refetch();
              }}
              className="px-3 py-1 text-sm border border-danger text-danger rounded hover:bg-danger/10"
            >
              Freeze
            </button>
          ) : (
            <button
              onClick={async () => {
                await apiPost(`/api/agents/${id}/unfreeze`, {});
                await refetch();
              }}
              className="px-3 py-1 text-sm border border-accent text-accent rounded hover:bg-accent/10"
            >
              Unfreeze
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatBox
          label="Daily cap"
          main={fmtUsdc(data.policy?.dailyCapMicroUsdc ?? 0)}
          sub={`spent ${fmtUsdc(data.spend.dailySpentMicroUsdc)}`}
        />
        <StatBox
          label="Monthly cap"
          main={fmtUsdc(data.policy?.monthlyCapMicroUsdc ?? 0)}
          sub={`spent ${fmtUsdc(data.spend.monthlySpentMicroUsdc)}`}
        />
        <StatBox
          label="Escalation ≥"
          main={fmtUsdc(data.policy?.humanThresholdMicroUsdc ?? 0)}
          sub={`risk threshold ${data.policy?.riskThreshold ?? '—'}`}
        />
      </div>

      <div className="card p-6">
        <h2 className="text-sm uppercase text-muted tracking-wide mb-3">Allowed routes</h2>
        {(data.policy?.allowedRoutes ?? []).length === 0 ? (
          <Empty>No routes allow-listed for this agent.</Empty>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {(data.policy?.allowedRoutes ?? []).map((r) => (
              <li key={r}>
                <Pill tone="accent">
                  <span className="font-mono">{r}</span>
                </Pill>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="p-4 border-b border-border text-sm uppercase text-muted tracking-wide">
          Recent activity
        </div>
        {data.transactions.length === 0 ? (
          <Empty>No traffic yet.</Empty>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {data.transactions.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="p-3 text-xs text-muted whitespace-nowrap">
                    {relTime(t.createdAt)}
                  </td>
                  <td className="p-3">
                    <StatusPill status={t.status} />
                  </td>
                  <td className="p-3 font-mono text-xs">{t.route}</td>
                  <td className="p-3 font-mono">{fmtUsdc(t.amountMicroUsdc)}</td>
                  <td className="p-3 text-xs">
                    {t.riskScore != null ? `risk ${t.riskScore}` : ''}
                  </td>
                  <td className="p-3 text-xs text-muted">{t.riskReason ?? ''}</td>
                  <td className="p-3 text-xs">
                    {t.algoTxnId && (
                      <a
                        className="text-accent hover:underline"
                        href={`https://lora.algokit.io/testnet/tx/${t.algoTxnId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        tx ↗
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, main, sub }: { label: string; main: string; sub: string }) {
  return (
    <div className="card p-5">
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="text-2xl font-mono mt-1">{main}</div>
      <div className="text-xs text-muted mt-1">{sub}</div>
    </div>
  );
}
