/**
 * Server-side admin signer for on-chain writes (record_spend, etc.).
 *
 * Loads ADMIN_MNEMONIC from env; auto-detects legacy 25-word vs BIP-39
 * (Pera Universal Wallet). BIP-39 uses ARC-52 via the same
 * @algorandfoundation/xhd-wallet-api the deploy scripts use — the two
 * derivations agree by construction.
 *
 * Servers without ADMIN_MNEMONIC still boot; on-chain writes just no-op
 * with a warning line.
 */
import algosdk from 'algosdk';
import * as bip39 from 'bip39';
import nacl from 'tweetnacl';
import {
  BIP32DerivationType,
  fromSeed,
  KeyContext,
  XHDWalletAPI,
} from '@algorandfoundation/xhd-wallet-api';
import { log } from '../lib/logger';

export type MnemonicFormat = 'algorand-25' | 'bip39-arc52';

export interface AdminSigner {
  address: string;
  format: MnemonicFormat;
  signPrefixedTxn(prefixed: Uint8Array): Promise<Uint8Array>;
}

let cache: Promise<AdminSigner | null> | undefined;

/** Idempotent — first call builds; subsequent calls return the cached instance. */
export function getAdminSigner(): Promise<AdminSigner | null> {
  if (cache) return cache;
  cache = build();
  return cache;
}

async function build(): Promise<AdminSigner | null> {
  const mnemonic = process.env.ADMIN_MNEMONIC?.trim();
  const accountIndex = parseInt(process.env.ADMIN_ACCOUNT_INDEX ?? '0', 10);

  if (!mnemonic) {
    log.warn('signer.unavailable', {
      hint: 'set ADMIN_MNEMONIC in apps/server/.env to enable on-chain writes',
    });
    return null;
  }

  const words = mnemonic.split(/\s+/).length;

  if (words === 25) {
    const acct = algosdk.mnemonicToSecretKey(mnemonic);
    const address = acct.addr.toString();
    log.info('signer.ready', { address, format: 'algorand-25' });
    return {
      address,
      format: 'algorand-25',
      async signPrefixedTxn(prefixed) {
        return nacl.sign.detached(prefixed, acct.sk as unknown as Uint8Array);
      },
    };
  }

  if ([12, 15, 18, 21, 24].includes(words)) {
    if (!bip39.validateMnemonic(mnemonic)) {
      log.error('signer.bad_bip39_checksum');
      return null;
    }
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    // fromSeed's type expects Buffer; the runtime accepts any Uint8Array.
    // Cast so strict TS doesn't complain about the mismatched brand.
    const rootKey = fromSeed(new Uint8Array(seed) as unknown as Buffer);
    const xhd = new XHDWalletAPI();
    const pub = await xhd.keyGen(
      rootKey,
      KeyContext.Address,
      accountIndex,
      0,
      BIP32DerivationType.Peikert
    );
    const address = algosdk.encodeAddress(new Uint8Array(pub));
    log.info('signer.ready', { address, format: 'bip39-arc52', accountIndex });
    return {
      address,
      format: 'bip39-arc52',
      async signPrefixedTxn(prefixed) {
        const sig = await xhd.signAlgoTransaction(
          rootKey,
          KeyContext.Address,
          accountIndex,
          0,
          prefixed,
          BIP32DerivationType.Peikert
        );
        return new Uint8Array(sig);
      },
    };
  }

  log.error('signer.bad_mnemonic_word_count', { words });
  return null;
}
