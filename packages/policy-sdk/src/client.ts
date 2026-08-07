import { wrapFetchWithPayment } from '@x402/fetch';

export interface AgentGuardResponse<T = unknown> {
  status: number;
  body: T;
  paymentTxId: string | null;
  escalation: { intentId: string; pollUrl: string; expiresAt: string } | null;
}

export interface AgentGuardClient {
  call<T = unknown>(path: string, init?: RequestInit): Promise<AgentGuardResponse<T>>;
  waitForApproval(intentId: string, timeoutMs?: number): Promise<'approved' | 'denied' | 'expired'>;
}

export interface Signer {
  address: string;
  signTransaction(txn: unknown): Promise<Uint8Array>;
  signGroup(txns: unknown[]): Promise<Uint8Array[]>;
}

export function makeAgentGuardClient(opts: {
  serverUrl: string;
  signer: Signer;
}): AgentGuardClient {
  const paid = wrapFetchWithPayment(fetch as unknown as typeof fetch, { signer: opts.signer } as any);

  return {
    async call<T = unknown>(path: string, init: RequestInit = {}): Promise<AgentGuardResponse<T>> {
      const headers = new Headers(init.headers);
      headers.set('x-agent-address', opts.signer.address);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');

      const res = await (paid as any)(new URL(path, opts.serverUrl).toString(), {
        ...init,
        headers,
      });
      const body = (await res.json().catch(() => ({}))) as any;

      if (res.status === 402 && body?.escalationIntentId) {
        return {
          status: 402,
          body,
          paymentTxId: null,
          escalation: {
            intentId: body.escalationIntentId,
            pollUrl: body.pollUrl,
            expiresAt: body.expiresAt,
          },
        };
      }
      return {
        status: res.status,
        body,
        paymentTxId: extractTx(res.headers),
        escalation: null,
      };
    },

    async waitForApproval(intentId, timeoutMs = 300_000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const r = await fetch(new URL(`/api/approvals/${intentId}`, opts.serverUrl).toString());
        const j = (await r.json()) as { status: string };
        if (j.status === 'approved') return 'approved';
        if (j.status === 'denied') return 'denied';
        await new Promise((res) => setTimeout(res, 1500));
      }
      return 'expired';
    },
  };
}

function extractTx(h: Headers): string | null {
  const raw = h.get('x-payment-response') ?? h.get('payment-response');
  if (!raw) return null;
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as { transaction?: string };
    return decoded.transaction ?? null;
  } catch {
    return null;
  }
}
