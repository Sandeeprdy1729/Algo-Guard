/**
 * record_spend caller — fires after `auditMiddleware` sees a settled
 * x402 payment. Not atomically bound to the USDC transfer (the x402
 * `exact` scheme doesn't expose an extension point for extra txns), but
 * the on-chain audit trail is real and the indexer picks the SPND log
 * into `audit_logs`.
 *
 * Best-effort by design: the caller (auditMiddleware) awaits nothing so
 * a chain-side failure never blocks the API response. Failures are
 * logged and surfaced via the `x402_record_spend_failed` structured log
 * for later reconciliation.
 */
import algosdk from 'algosdk';
import crypto from 'node:crypto';
import { algod, POLICY_APP_ID } from './client';
import { getAdminSigner } from './signer';
import { log } from '../lib/logger';

const SELECTOR = abiSelector('record_spend(address,uint64,byte[])void');

/** Fire-and-forget. Never throws. */
export async function recordSpend(input: {
  agentAddress: string;
  route: string;
  amountMicroUsdc: number;
  requestId: string;
}): Promise<void> {
  if (!POLICY_APP_ID) {
    log.debug('recordSpend.skipped', { reason: 'POLICY_APP_ID unset' });
    return;
  }
  const signer = await getAdminSigner();
  if (!signer) {
    log.warn('recordSpend.no_signer', { requestId: input.requestId });
    return;
  }
  try {
    const sp = await algod.getTransactionParams().do();
    const agentPk = algosdk.decodeAddress(input.agentAddress).publicKey;
    const routeHash = crypto.createHash('sha256').update(input.route).digest();

    const appArgs: Uint8Array[] = [
      SELECTOR,
      agentPk,
      algosdk.encodeUint64(input.amountMicroUsdc),
      abiDynamicBytes(new Uint8Array(routeHash)),
    ];

    const txn = algosdk.makeApplicationNoOpTxnFromObject({
      sender: signer.address,
      appIndex: POLICY_APP_ID,
      appArgs,
      boxes: [{ appIndex: POLICY_APP_ID, name: agentPk }],
      suggestedParams: sp,
    });

    const prefixed = txn.bytesToSign();
    const sig = await signer.signPrefixedTxn(prefixed);
    const signedBlob = attachSignature(txn, sig);
    const { txid } = (await algod.sendRawTransaction(signedBlob).do()) as { txid: string };

    log.info('recordSpend.submitted', {
      requestId: input.requestId,
      agentAddress: input.agentAddress,
      amountMicroUsdc: input.amountMicroUsdc,
      txid,
    });

    // Wait for confirmation in the background so we surface hard failures
    // (cap breach, frozen agent) as clear log lines, but don't block.
    algosdk
      .waitForConfirmation(algod, txid, 5)
      .then(() =>
        log.info('recordSpend.confirmed', {
          requestId: input.requestId,
          txid,
        })
      )
      .catch((err) =>
        log.warn('recordSpend.confirm_failed', {
          requestId: input.requestId,
          txid,
          msg: (err as Error).message,
        })
      );
  } catch (err) {
    log.error('recordSpend.failed', {
      requestId: input.requestId,
      agentAddress: input.agentAddress,
      msg: (err as Error).message,
    });
  }
}

function abiSelector(sig: string): Uint8Array {
  // ABI selector = first 4 bytes of SHA-512/256(sig).
  // Node has no built-in sha512/256; use algosdk's or hash sha512 and truncate.
  // The ARC-4 spec uses SHA-512/256 which equals SHA-512 truncated to 256
  // bits WITH a different IV. That IV difference matters — Node's crypto
  // doesn't ship it. We'll import from js-sha512 dynamically instead.
  const { sha512_256 } = require('js-sha512');
  return new Uint8Array(sha512_256.array(sig)).subarray(0, 4);
}

function abiDynamicBytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + bytes.length);
  new DataView(out.buffer).setUint16(0, bytes.length, false);
  out.set(bytes, 2);
  return out;
}

function attachSignature(txn: algosdk.Transaction, sig: Uint8Array): Uint8Array {
  const stx = new algosdk.SignedTransaction({ sig, txn });
  return algosdk.encodeMsgpack(stx);
}
