/**
 * x402-aware fetch wrapper for the AgentGuard demo agent.
 *
 * Composes:
 *   toClientAvmSigner(privBase64)  → AVM signer
 *   new ExactAvmScheme(signer)     → client-side "exact" scheme
 *   x402Client.fromConfig(...)     → SDK client
 *   wrapFetchWithPayment(fetch, c) → fetch that handles the 402 dance
 *
 * On top of that we add:
 *   - the mandatory `X-Agent-Address` header for AgentGuard middleware
 *   - detection of AgentGuard's `escalationIntentId` in 402 payloads
 *   - a helper to poll the approval status until human decides
 */
import { wrapFetchWithPayment } from '@x402/fetch';
import { x402Client } from '@x402/core/client';
import {
  ALGORAND_TESTNET_CAIP2,
  ExactAvmScheme,
  toClientAvmSigner,
} from '@x402/avm';
import { x402Version } from '@x402/core';
import type { Wallet } from './wallet.js';

export interface AgentGuardResponse<T = unknown> {
  status: number;
  body: T;
  paymentTxId: string | null;
  escalation: { intentId: string; pollUrl: string; expiresAt: string } | null;
  reason?: string;
}

export function makeClient(serverUrl: string, wallet: Wallet) {
  const signer = toClientAvmSigner(wallet.privateKeyBase64);

  const client = x402Client.fromConfig({
    schemes: [
      {
        x402Version,
        network: ALGORAND_TESTNET_CAIP2,
        client: new ExactAvmScheme(signer),
      },
    ],
  });

  const paidFetch = wrapFetchWithPayment(fetch, client);

  return {
    async call<T = unknown>(path: string, init: RequestInit = {}): Promise<AgentGuardResponse<T>> {
      const headers = new Headers(init.headers);
      headers.set('x-agent-address', wallet.address);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');

      const res = await paidFetch(new URL(path, serverUrl).toString(), {
        ...init,
        headers,
      });

      const body = (await res.json().catch(() => ({}))) as any;

      if (res.status === 402 && body?.escalationIntentId) {
        return {
          status: 402,
          body: body as T,
          paymentTxId: null,
          escalation: {
            intentId: body.escalationIntentId,
            pollUrl: body.pollUrl,
            expiresAt: body.expiresAt,
          },
          reason: body.reason,
        };
      }

      return {
        status: res.status,
        body: body as T,
        paymentTxId: extractPaymentTxId(res.headers),
        escalation: null,
      };
    },

    async waitForApproval(
      intentId: string,
      timeoutMs = 300_000
    ): Promise<'approved' | 'denied' | 'expired'> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const r = await fetch(new URL(`/api/approvals/${intentId}`, serverUrl).toString());
        const j = (await r.json()) as { status: string };
        if (j.status === 'approved') return 'approved';
        if (j.status === 'denied') return 'denied';
        await new Promise((res) => setTimeout(res, 2000));
      }
      return 'expired';
    },
  };
}

function extractPaymentTxId(h: Headers): string | null {
  const raw = h.get('x-payment-response') ?? h.get('payment-response');
  if (!raw) return null;
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as {
      transaction?: string;
    };
    return decoded.transaction ?? null;
  } catch {
    return null;
  }
}
