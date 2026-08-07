#!/usr/bin/env node
/**
 * ARC-52 (Peikert BIP-32-Ed25519) wallet CLI.
 *
 * Two subcommands consumed by Python (contracts/wallet.py + deploy.py):
 *
 *   derive
 *     Reads env MNEMONIC + ACCOUNT_INDEX, prints one JSON line to stdout:
 *       { address, format, hdPath }
 *
 *   sign
 *     Reads env MNEMONIC + ACCOUNT_INDEX and one JSON line on stdin:
 *       { txnBase64 }   ← base64 msgpack of the UNSIGNED txn
 *     Prints one JSON line on stdout:
 *       { sigBase64 }   ← base64 of the 64-byte ed25519 signature
 *
 * Only handles BIP-39 mnemonics. Legacy 25-word phrases stay in Python.
 *
 * Uses @algorandfoundation/xhd-wallet-api (ARC-52 reference impl) with
 * Peikert derivation type — verified to match Pera Universal Wallet.
 */
import bip39 from 'bip39';
import algosdk from 'algosdk';
import {
  XHDWalletAPI,
  KeyContext,
  BIP32DerivationType,
  fromSeed,
} from '@algorandfoundation/xhd-wallet-api';

const MNEMONIC = process.env.MNEMONIC?.trim();
const ACCOUNT_INDEX = parseInt(process.env.ACCOUNT_INDEX ?? '0', 10);

function die(msg) {
  process.stderr.write(msg + '\n');
  process.exit(1);
}

if (!MNEMONIC) die('MNEMONIC env var required');
if (!bip39.validateMnemonic(MNEMONIC)) die('MNEMONIC failed BIP-39 checksum');

const bip39Seed = bip39.mnemonicToSeedSync(MNEMONIC);
const rootKey = fromSeed(new Uint8Array(bip39Seed));
const xhd = new XHDWalletAPI();
const HD_PATH = `m/44'/283'/${ACCOUNT_INDEX}'/0/0`;

async function derive() {
  const pub = await xhd.keyGen(
    rootKey,
    KeyContext.Address,
    ACCOUNT_INDEX,
    0,
    BIP32DerivationType.Peikert
  );
  process.stdout.write(
    JSON.stringify({
      address: algosdk.encodeAddress(new Uint8Array(pub)),
      format: 'bip39-arc52',
      hdPath: HD_PATH,
    }) + '\n'
  );
}

async function sign() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) die('stdin: empty');
  const { txnBase64 } = JSON.parse(raw);
  if (!txnBase64) die('stdin: missing txnBase64');

  const prefixedTxn = new Uint8Array(Buffer.from(txnBase64, 'base64'));
  const sig = await xhd.signAlgoTransaction(
    rootKey,
    KeyContext.Address,
    ACCOUNT_INDEX,
    0,
    prefixedTxn,
    BIP32DerivationType.Peikert
  );
  process.stdout.write(
    JSON.stringify({ sigBase64: Buffer.from(sig).toString('base64') }) + '\n'
  );
}

const cmd = process.argv[2];
if (cmd === 'derive') await derive();
else if (cmd === 'sign') await sign();
else die(`unknown command "${cmd}" — expected "derive" or "sign"`);
