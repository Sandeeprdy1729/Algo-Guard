/**
 * Wallet loader — supports two mnemonic formats:
 *
 *   • Legacy Algorand mnemonic — 25 words, 11-bit-per-word packing, one
 *     account per phrase. Used by the KMD, `goal`, and the classic Pera
 *     "Show Passphrase" flow.
 *
 *   • BIP-39 mnemonic (12 / 15 / 18 / 21 / 24 words) — used by the new
 *     Pera Universal Wallet, MyAlgo replacement flows, and any wallet
 *     that follows the HD-derivation model. The seed is used with
 *     SLIP-0010 ed25519 derivation along the Algorand HD path
 *     m/44'/283'/{ACCOUNT_INDEX}'/0'/0' (all levels hardened — required
 *     for ed25519). Cross-verified against Python bip_utils.
 *
 * The word count in the phrase decides which flow is taken; the caller
 * doesn't need to say. `ACCOUNT_INDEX` overrides the default index 0
 * so future support for multiple derived accounts is a one-env-var
 * change.
 *
 * Downstream code (client.ts, @x402/avm signer, algosdk txn signing)
 * consumes the returned {address, privateKeyBase64} unchanged.
 */
import algosdk from 'algosdk';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';

export type MnemonicFormat = 'algorand-25' | 'bip39';

export interface Wallet {
  address: string;
  privateKeyBase64: string;
  format: MnemonicFormat;
  /** Present only for BIP-39 wallets; describes what was derived. */
  hdPath?: string;
}

export interface LoadOptions {
  /** Zero-based account index for the BIP-39 HD path. Defaults to 0. */
  accountIndex?: number;
}

const LEGACY_WORDS = 25;
const BIP39_WORDS = new Set([12, 15, 18, 21, 24]);

export function detectFormat(mnemonic: string): MnemonicFormat {
  const words = mnemonic.trim().split(/\s+/);
  if (words.length === LEGACY_WORDS) return 'algorand-25';
  if (BIP39_WORDS.has(words.length)) return 'bip39';
  throw new Error(
    `Unrecognised mnemonic word count: ${words.length}. ` +
      `Expected 25 (Algorand legacy) or 12/15/18/21/24 (BIP-39).`
  );
}

export function loadWallet(mnemonic: string, opts: LoadOptions = {}): Wallet {
  const format = detectFormat(mnemonic);
  if (format === 'algorand-25') return loadLegacy(mnemonic);
  return loadBip39(mnemonic, opts.accountIndex ?? 0);
}

function loadLegacy(mnemonic: string): Wallet {
  const account = algosdk.mnemonicToSecretKey(mnemonic);
  return {
    address: account.addr.toString(),
    privateKeyBase64: Buffer.from(account.sk).toString('base64'),
    format: 'algorand-25',
  };
}

/**
 * BIP-39 → Algorand keypair.
 *
 * Algorand SLIP-0044 coin type is 283. ed25519 SLIP-0010 requires every
 * segment to be hardened, so the standard path is:
 *
 *     m/44'/283'/<account>'/0'/0'
 *
 * We derive the 32-byte ed25519 seed at that path, hand it back through
 * `algosdk.mnemonicFromSeed` → 25-word mnemonic → `mnemonicToSecretKey`
 * so the downstream shape is identical to the legacy path.
 */
function loadBip39(mnemonic: string, accountIndex: number): Wallet {
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('BIP-39 mnemonic failed checksum validation');
  }
  const path = hdPath(accountIndex);
  const bip39Seed = bip39.mnemonicToSeedSync(mnemonic); // 64 bytes
  const { key } = derivePath(path, bip39Seed.toString('hex')); // 32-byte ed25519 seed
  const algorand25 = algosdk.mnemonicFromSeed(new Uint8Array(key));
  const account = algosdk.mnemonicToSecretKey(algorand25);
  return {
    address: account.addr.toString(),
    privateKeyBase64: Buffer.from(account.sk).toString('base64'),
    format: 'bip39',
    hdPath: path,
  };
}

export function hdPath(accountIndex: number): string {
  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new Error(`accountIndex must be a non-negative integer, got ${accountIndex}`);
  }
  return `m/44'/283'/${accountIndex}'/0'/0'`;
}
