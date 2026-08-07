/**
 * Algorand SDK clients (algod + indexer).
 */
import algosdk from 'algosdk';

const ALGOD_URL = process.env.ALGOD_URL ?? 'https://testnet-api.algonode.cloud';
const ALGOD_TOKEN = process.env.ALGOD_TOKEN ?? '';
const INDEXER_URL = process.env.INDEXER_URL ?? 'https://testnet-idx.algonode.cloud';

export const algod = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_URL, '');
export const indexer = new algosdk.Indexer(ALGOD_TOKEN, INDEXER_URL, '');

export const POLICY_APP_ID = parseInt(process.env.POLICY_APP_ID ?? '0', 10);
export const POLICY_APP_ADDRESS = process.env.POLICY_APP_ADDRESS ?? '';

export function loraUrl(txId: string): string {
  return `https://lora.algokit.io/testnet/tx/${txId}`;
}

export function loraAppUrl(appId: number): string {
  return `https://lora.algokit.io/testnet/application/${appId}`;
}
