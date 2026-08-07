/**
 * Wallet loader tests.
 *
 * Cross-implementation compatibility with the Python loader is asserted
 * by hard-coding the address the shared reference vector should derive
 * to at m/44'/283'/0'/0'/0'. If either loader drifts, this test breaks.
 *
 * Run:
 *   node_modules/.bin/tsx --test src/wallet.test.ts
 */
import { after, before, describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import algosdk from 'algosdk';

import { detectFormat, hdPath, loadWallet } from './wallet.js';

// ── Reference vectors ─────────────────────────────────────────────
// 24-word BIP-39: 23× "abandon" + checksum "art". Cross-derived on the
// Python side (bip_utils.Bip44.ALGORAND with the same 5-hardened path).
const BIP39_24 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
const BIP39_24_ADDR_IDX0 =
  '3DCHXKKTAQWB2PRAPY3IIMQ23F4J4Y2M57UCRV4ZBXRATQNAIYR7CPOPG4';

describe('wallet.detectFormat', () => {
  test('25 words → algorand-25', () => {
    const mn25 = algosdk.mnemonicFromSeed(new Uint8Array(32));
    assert.equal(detectFormat(mn25), 'algorand-25');
  });
  test('24 words → bip39', () => {
    assert.equal(detectFormat(BIP39_24), 'bip39');
  });
  test('12 words → bip39', () => {
    const twelve = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    assert.equal(detectFormat(twelve), 'bip39');
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
  test('index 0 default', () => {
    assert.equal(hdPath(0), "m/44'/283'/0'/0'/0'");
  });
  test('index 5', () => {
    assert.equal(hdPath(5), "m/44'/283'/5'/0'/0'");
  });
  test('rejects negatives / non-integers', () => {
    assert.throws(() => hdPath(-1), /non-negative integer/);
    assert.throws(() => hdPath(1.5), /non-negative integer/);
  });
});

describe('wallet.loadWallet — legacy 25-word round trip', () => {
  test('deterministic address from a known seed', () => {
    const seed = new Uint8Array(32).fill(7); // deterministic seed
    const mn25 = algosdk.mnemonicFromSeed(seed);
    const w1 = loadWallet(mn25);
    // Match against algosdk directly.
    const expected = algosdk.mnemonicToSecretKey(mn25);
    assert.equal(w1.address, expected.addr.toString());
    assert.equal(w1.format, 'algorand-25');
    assert.equal(w1.hdPath, undefined);
    // sk round-trips.
    assert.equal(w1.privateKeyBase64, Buffer.from(expected.sk).toString('base64'));
  });

  test('two loads of the same mnemonic yield the same wallet', () => {
    const mn25 = algosdk.mnemonicFromSeed(new Uint8Array(32).fill(9));
    const a = loadWallet(mn25);
    const b = loadWallet(mn25);
    assert.deepEqual(a, b);
  });
});

describe('wallet.loadWallet — BIP-39 24-word', () => {
  test('derives the cross-implementation reference address at index 0', () => {
    const w = loadWallet(BIP39_24);
    assert.equal(w.address, BIP39_24_ADDR_IDX0);
    assert.equal(w.format, 'bip39');
    assert.equal(w.hdPath, "m/44'/283'/0'/0'/0'");
    // sk should be 64 bytes when decoded.
    assert.equal(Buffer.from(w.privateKeyBase64, 'base64').length, 64);
  });

  test('accountIndex changes the derived address', () => {
    const a = loadWallet(BIP39_24, { accountIndex: 0 });
    const b = loadWallet(BIP39_24, { accountIndex: 1 });
    assert.notEqual(a.address, b.address);
    assert.equal(b.hdPath, "m/44'/283'/1'/0'/0'");
  });

  test('BIP-39 wallet can sign a transaction (algosdk sees a real keypair)', async () => {
    const w = loadWallet(BIP39_24);
    // Build a minimal txn and sign — throws on any keypair inconsistency.
    const sp: algosdk.SuggestedParams = {
      fee: 1000n,
      firstValid: 1n,
      lastValid: 100n,
      genesisHash: new Uint8Array(32),
      genesisID: 'testnet-v1.0',
      flatFee: true,
      minFee: 1000n,
    };
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: w.address,
      receiver: w.address,
      amount: 0,
      suggestedParams: sp,
    });
    const sk = Buffer.from(w.privateKeyBase64, 'base64');
    const signed = txn.signTxn(new Uint8Array(sk));
    assert.ok(signed.length > 0);
  });

  test('rejects BIP-39 phrase with bad checksum', () => {
    const bad = BIP39_24.replace(/art$/, 'zoo'); // valid word, wrong checksum
    assert.throws(() => loadWallet(bad), /checksum/i);
  });
});

describe('wallet cross-format sanity', () => {
  test('legacy and BIP-39 for equivalent 32-byte seeds produce different addresses (proves distinct derivation)', () => {
    // The two encodings are NOT interchangeable — same-looking bytes
    // give different addresses because BIP-39 goes through PBKDF2 + HD
    // derivation before hitting the ed25519 seed. This test just guards
    // against an accidental short-circuit that would treat one as the other.
    const mn25 = algosdk.mnemonicFromSeed(new Uint8Array(32));
    const legacy = loadWallet(mn25);
    const bip39 = loadWallet(BIP39_24);
    assert.notEqual(legacy.address, bip39.address);
    assert.equal(legacy.format, 'algorand-25');
    assert.equal(bip39.format, 'bip39');
  });
});
