/**
 * Wraps our dual-format Wallet as an AVM signer the @x402/avm
 * ExactAvmScheme accepts.
 *
 * ExactAvmScheme's client-side call pattern (verified against the v2.12
 * source in node_modules):
 *   this.signer.address                              // string
 *   this.signer.signTransactions(encodedTxns, ixs)   // returns signed msgpack for each `ixs` index
 *
 * For every index in `indexesToSign` we:
 *   1. Prepend the "TX" domain-separation tag to the encoded (unsigned)
 *      txn — this is what algosdk considers the "bytes to sign".
 *   2. Ask our wallet for the 64-byte ed25519 signature (legacy uses
 *      algosdk sk, BIP-39 uses ARC-52 via xhd-wallet-api).
 *   3. Assemble the SignedTransaction msgpack: {sig, txn}.
 * Every other index returns null (algosdk composer already handled it).
 */
import algosdk from 'algosdk';
import type { Wallet } from './wallet.js';

const TX_TAG = new Uint8Array([0x54, 0x58]); // "TX"

export interface AVMSignerLike {
  address: string;
  signTransactions(
    encodedTxns: Uint8Array[],
    indexesToSign?: number[]
  ): Promise<(Uint8Array | null)[]>;
}

export function walletToAvmSigner(wallet: Wallet): AVMSignerLike {
  return {
    address: wallet.address,
    async signTransactions(encodedTxns, indexesToSign) {
      const targets = new Set(indexesToSign ?? encodedTxns.map((_, i) => i));
      const out: (Uint8Array | null)[] = new Array(encodedTxns.length).fill(null);
      for (let i = 0; i < encodedTxns.length; i++) {
        if (!targets.has(i)) continue;
        const txnBytes = encodedTxns[i];
        const prefixed = new Uint8Array(TX_TAG.length + txnBytes.length);
        prefixed.set(TX_TAG, 0);
        prefixed.set(txnBytes, TX_TAG.length);
        const sig = await wallet.signPrefixedTxn(prefixed);
        // Build SignedTransaction msgpack directly. algosdk.decodeUnsignedTransaction
        // gives us a Transaction we can wrap.
        const txn = algosdk.decodeUnsignedTransaction(txnBytes);
        const stx = new algosdk.SignedTransaction({ sig, txn });
        out[i] = algosdk.encodeMsgpack(stx);
      }
      return out;
    },
  };
}
