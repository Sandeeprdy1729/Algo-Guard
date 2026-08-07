/**
 * Background indexer.
 *
 * Polls the Algorand indexer for application-call transactions targeting
 * the policy contract, decodes the `log()` events the contract emits, and
 * materializes them into the `audit_logs` table plus SSE broadcasts.
 *
 * If POLICY_APP_ID is 0 (contract not deployed yet), the indexer no-ops
 * — the rest of the server still works for the middleware demo.
 */
import { indexer, POLICY_APP_ID } from './client';
import { prisma } from './prisma';
import { emit } from '../api/stream';
import { log } from '../lib/logger';

const POLL_MS = 4_000;

interface Cursor {
  round: bigint;
}

let cursor: Cursor = { round: 0n };

export async function startIndexer() {
  if (!POLICY_APP_ID) {
    log.info('indexer.skipped', { reason: 'POLICY_APP_ID unset' });
    return;
  }

  const latest = await prisma.auditLog.findFirst({ orderBy: { round: 'desc' } });
  if (latest) cursor.round = latest.round + 1n;

  log.info('indexer.starting', { round: cursor.round.toString(), appId: POLICY_APP_ID });

  const tick = async () => {
    try {
      await pollOnce();
    } catch (err: any) {
      log.warn('indexer.poll_error', { msg: err.message });
    }
    setTimeout(tick, POLL_MS);
  };
  tick();
}

async function pollOnce() {
  const res: any = await indexer
    .searchForTransactions()
    .applicationID(POLICY_APP_ID)
    .minRound(Number(cursor.round))
    .do();

  const txns: any[] = res.transactions ?? [];
  for (const t of txns) {
    const round = BigInt(t['confirmed-round'] ?? 0);
    if (round < cursor.round) continue;
    const txId: string = t.id;
    const logs: string[] = t.logs ?? [];
    for (const b64 of logs) {
      const buf = Buffer.from(b64, 'base64');
      const decoded = decodeLog(buf);
      if (!decoded) continue;
      try {
        const row = await prisma.auditLog.create({
          data: {
            round,
            algoTxnId: txId,
            eventType: decoded.type,
            agentAddress: decoded.agentAddress ?? null,
            payload: decoded.payload,
          },
        });
        emit({
          type: 'audit',
          data: {
            id: row.id.toString(),
            round: round.toString(),
            algoTxnId: txId,
            eventType: row.eventType,
            agentAddress: row.agentAddress,
            payload: row.payload,
            createdAt: row.createdAt.toISOString(),
          },
        });
      } catch {
        // unique(algoTxnId) — already seen; skip.
      }
    }
    cursor.round = round + 1n;
  }
}

/**
 * Log format (produced by contracts/policy_contract.py):
 *   [4-byte tag][32-byte address?][payload…]
 *
 * Tags:  "SPND" spend  "APOL" policy update  "AAPR" approval  "FRZE" freeze
 */
function decodeLog(buf: Buffer): { type: string; agentAddress?: string; payload: any } | null {
  if (buf.length < 4) return null;
  const tag = buf.slice(0, 4).toString('utf8');
  const rest = buf.slice(4);

  const map: Record<string, string> = {
    SPND: 'SPEND',
    APOL: 'POLICY_UPDATE',
    AAPR: 'APPROVAL',
    FRZE: 'FREEZE',
  };
  const type = map[tag];
  if (!type) return null;

  // First 32 bytes of `rest` are typically the agent address's public key.
  if (rest.length >= 32) {
    const algosdk = require('algosdk') as typeof import('algosdk');
    const addr = algosdk.encodeAddress(rest.slice(0, 32));
    const trail = rest.slice(32);
    return {
      type,
      agentAddress: addr,
      payload: { tail: trail.toString('hex') },
    };
  }
  return { type, payload: { raw: rest.toString('hex') } };
}
