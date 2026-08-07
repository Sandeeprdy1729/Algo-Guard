/**
 * Wallet loader — supports two mnemonic formats:
 *
 *   • Legacy Algorand mnemonic — 25 words, 11-bit-per-word packing, one
 *     account per phrase. Signs in-process with algosdk.
 *
 *   • BIP-39 mnemonic (12 / 15 / 18 / 21 / 24 words) — Pera Universal
 *     Wallet. Follows Algorand's ARC-52 spec: BIP-32-Ed25519 with the
 *     Peikert amendment, path m/44'/283'/{ACCOUNT_INDEX}'/0/0. Signs
 *     via @algorandfoundation/xhd-wallet-api. Cross-verified against
 *     Python contracts/wallet.py.
 *
 * The word count decides the flow; the caller doesn't need to say. The
 * returned Wallet exposes a `signPrefixedTxn(bytes)` method that both
 * formats implement, so downstream signers don't care which was used.
 */
import algosdk from 'algosdk';
import nacl from 'tweetnacl';
import * as bip39 from 'bip39';
import {
  BIP32DerivationType,
  fromSeed,
  KeyContext,
  XHDWalletAPI,
} from '@algorandfoundation/xhd-wallet-api';

export type MnemonicFormat = 'algorand-25' | 'bip39-arc52';

export interface Wallet {
  address: string;
  format: MnemonicFormat;
  hdPath?: string;
  /** Sign the "TX"-prefixed bytes-to-sign of an Algorand txn. Returns 64-byte sig. */
  signPrefixedTxn(prefixed: Uint8Array): Promise<Uint8Array>;
}

export interface LoadOptions {
  accountIndex?: number;
}

const LEGACY_WORDS = 25;
const BIP39_WORDS = new Set([12, 15, 18, 21, 24]);

export function detectFormat(mnemonic: string): MnemonicFormat {
  const words = mnemonic.trim().split(/\s+/);
  if (words.length === LEGACY_WORDS) return 'algorand-25';
  if (BIP39_WORDS.has(words.length)) return 'bip39-arc52';
  throw new Error(
    `Unrecognised mnemonic word count: ${words.length}. ` +
      `Expected 25 (Algorand legacy) or 12/15/18/21/24 (BIP-39).`
  );
}

export function hdPath(accountIndex: number): string {
  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new Error(`accountIndex must be a non-negative integer, got ${accountIndex}`);
  }
  return `m/44'/283'/${accountIndex}'/0/0`;
}

export async function loadWallet(
  mnemonic: string,
  opts: LoadOptions = {}
): Promise<Wallet> {
  const format = detectFormat(mnemonic);
  const accountIndex = opts.accountIndex ?? 0;
  if (format === 'algorand-25') return loadLegacy(mnemonic);
  return loadArc52(mnemonic, accountIndex);
}

function loadLegacy(mnemonic: string): Wallet {
  const account = algosdk.mnemonicToSecretKey(mnemonic);
  return {
    address: account.addr.toString(),
    format: 'algorand-25',
    async signPrefixedTxn(prefixed) {
      return nacl.sign.detached(prefixed, account.sk as unknown as Uint8Array);
    },
  };
}

async function loadArc52(mnemonic: string, accountIndex: number): Promise<Wallet> {
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('BIP-39 mnemonic failed checksum validation');
  }
  const path = hdPath(accountIndex);
  const seed = bip39.mnemonicToSeedSync(mnemonic);
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

  return {
    address,
    format: 'bip39-arc52',
    hdPath: path,
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
