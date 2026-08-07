/**
 * Wallet loader tests — Node side.
 *
 * The BIP-39 reference address matches the one hard-coded in
 * contracts/tests/test_wallet.py; if either drifts, both suites fail
 * loudly, catching cross-language regressions.
 *
 * Run:  node_modules/.bin/tsx --test src/wallet.test.ts
 */
import { after, before, describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import algosdk from 'algosdk';
import nacl from 'tweetnacl';

import { detectFormat, hdPath, loadWallet } from './wallet.js';

// 24-word BIP-39: 23× "abandon" + checksum "art".
// Cross-verified: same address emitted by xhd-cli.mjs and Python wallet.py.
const BIP39_24 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
const BIP39_24_PERA_ADDR_IDX0 =
  'IYRGHE7NYTZRYPGFFNVPH7TVCZVQLQFK2IJ57W5JONTHT4BZEYHXL3MY3E';

describe('wallet.detectFormat', () => {
  test('25 words → algorand-25', () => {
    const mn25 = algosdk.mnemonicFromSeed(new Uint8Array(32));
    assert.equal(detectFormat(mn25), 'algorand-25');
  });
  test('24 words → bip39-arc52', () => {
    assert.equal(detectFormat(BIP39_24), 'bip39-arc52');
  });
  test('12 words → bip39-arc52', () => {
    const twelve =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    assert.equal(detectFormat(twelve), 'bip39-arc52');
  });
  test('collapses runs of whitespace', () => {
    const mn25 = algosdk.mnemonicFromSeed(new Uint8Array(32));
    assert.equal(detectFormat('  ' + mn25.replace(/ /g, '   ') + '  '), 'algorand-25');
  });
  test('other counts throw', () => {
    assert.throws(() => detectFormat('one two three four'), /Unrecognised mnemonic word count/);
  });
});

describe('wallet.hdPath', () => {
  test('index 0 default (Peikert path, last two levels non-hardened)', () => {
    assert.equal(hdPath(0), "m/44'/283'/0'/0/0");
  });
  test('index 5', () => {
    assert.equal(hdPath(5), "m/44'/283'/5'/0/0");
  });
  test('rejects negatives / non-integers', () => {
    assert.throws(() => hdPath(-1), /non-negative integer/);
    assert.throws(() => hdPath(1.5), /non-negative integer/);
  });
});

describe('wallet.loadWallet — legacy 25-word', () => {
  test('deterministic address from a known seed', async () => {
    const seed = new Uint8Array(32).fill(7);
    const mn25 = algosdk.mnemonicFromSeed(seed);
    const w = await loadWallet(mn25);
    const expected = algosdk.mnemonicToSecretKey(mn25);
    assert.equal(w.address, expected.addr.toString());
    assert.equal(w.format, 'algorand-25');
    assert.equal(w.hdPath, undefined);
  });

  test('legacy sig verifies against derived pubkey', async () => {
    const mn25 = algosdk.mnemonicFromSeed(new Uint8Array(32).fill(3));
    const w = await loadWallet(mn25);
    const prefixed = new TextEncoder().encode('TXpayload');
    const sig = await w.signPrefixedTxn(prefixed);
    const pk = algosdk.decodeAddress(w.address).publicKey;
    assert.ok(nacl.sign.detached.verify(prefixed, sig, pk));
  });
});

describe('wallet.loadWallet — BIP-39 (ARC-52 / Peikert)', () => {
  test('derives Pera-compatible reference address at index 0', async () => {
    const w = await loadWallet(BIP39_24);
    assert.equal(w.address, BIP39_24_PERA_ADDR_IDX0);
    assert.equal(w.format, 'bip39-arc52');
    assert.equal(w.hdPath, "m/44'/283'/0'/0/0");
  });

  test('accountIndex changes the derived address', async () => {
    const a = await loadWallet(BIP39_24, { accountIndex: 0 });
    const b = await loadWallet(BIP39_24, { accountIndex: 1 });
    assert.notEqual(a.address, b.address);
    assert.equal(b.hdPath, "m/44'/283'/1'/0/0");
  });

  test('ARC-52 sig verifies against derived pubkey', async () => {
    const w = await loadWallet(BIP39_24);
    const prefixed = new TextEncoder().encode('TXthe quick brown fox');
    const sig = await w.signPrefixedTxn(prefixed);
    const pk = algosdk.decodeAddress(w.address).publicKey;
    assert.ok(nacl.sign.detached.verify(prefixed, sig, pk));
  });

  test('rejects BIP-39 phrase with bad checksum', async () => {
    const bad = BIP39_24.replace(/art$/, 'zoo');
    await assert.rejects(loadWallet(bad), /checksum/i);
  });
});

describe('wallet cross-format sanity', () => {
  test('legacy and BIP-39 for the same 32 bytes derive different addresses', async () => {
    const mn25 = algosdk.mnemonicFromSeed(new Uint8Array(32));
    const legacy = await loadWallet(mn25);
    const bip = await loadWallet(BIP39_24);
    assert.notEqual(legacy.address, bip.address);
    assert.equal(legacy.format, 'algorand-25');
    assert.equal(bip.format, 'bip39-arc52');
  });
});
