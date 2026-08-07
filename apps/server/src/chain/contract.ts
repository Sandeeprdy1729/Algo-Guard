/**
 * Thin ABI wrapper around the AgentGuard policy contract.
 *
 * The contract is deployed once from contracts/deploy.py. Its methods:
 *   create_agent(addr, dailyCap, monthlyCap, humanThreshold, allowedRoutes[])
 *   update_policy(addr, dailyCap, monthlyCap, humanThreshold, allowedRoutes[])
 *   record_spend(addr, amount, routeHash)          — called atomically with USDC transfer
 *   approve_intent(intentId, approver)
 *   freeze_agent(addr)
 *
 * State lives in box storage keyed by the agent address.
 *
 * For the hackathon MVP, most dashboard mutations sign from the admin's
 * Pera wallet in-browser. The server only needs to READ contract state
 * and BUILD unsigned transactions the browser then signs. Those two are
 * implemented here.
 */
import algosdk from 'algosdk';
import { algod, POLICY_APP_ID, POLICY_APP_ADDRESS } from './client';
import crypto from 'node:crypto';

export interface OnChainPolicy {
  dailyCapMicroUsdc: bigint;
  monthlyCapMicroUsdc: bigint;
  humanThresholdMicroUsdc: bigint;
  allowedRoutes: string[];
  dailySpent: bigint;
  monthlySpent: bigint;
  frozen: boolean;
}

export function routeHash(route: string): Uint8Array {
  return new Uint8Array(crypto.createHash('sha256').update(route).digest());
}

/** Read a box; returns null if it doesn't exist. */
export async function readAgentBox(agentAddress: string): Promise<Uint8Array | null> {
  if (!POLICY_APP_ID) return null;
  try {
    const boxName = algosdk.decodeAddress(agentAddress).publicKey;
    const res = await algod.getApplicationBoxByName(POLICY_APP_ID, boxName).do();
    return res.value;
  } catch (err: any) {
    if (String(err.message ?? '').includes('box not found')) return null;
    throw err;
  }
}

/**
 * Build (unsigned) unsigned transactions that the browser wallet will
 * sign for `create_agent`. The server never holds the admin key.
 */
export async function buildCreateAgentTxns(args: {
  adminAddress: string;
  agentAddress: string;
  dailyCapMicroUsdc: bigint;
  monthlyCapMicroUsdc: bigint;
  humanThresholdMicroUsdc: bigint;
  allowedRoutes: string[];
}): Promise<algosdk.Transaction[]> {
  const sp = await algod.getTransactionParams().do();
  const boxName = algosdk.decodeAddress(args.agentAddress).publicKey;

  const appArgs: Uint8Array[] = [
    new TextEncoder().encode('create_agent'),
    algosdk.decodeAddress(args.agentAddress).publicKey,
    algosdk.encodeUint64(args.dailyCapMicroUsdc),
    algosdk.encodeUint64(args.monthlyCapMicroUsdc),
    algosdk.encodeUint64(args.humanThresholdMicroUsdc),
    new TextEncoder().encode(args.allowedRoutes.join('\n')),
  ];

  const call = algosdk.makeApplicationNoOpTxnFromObject({
    sender: args.adminAddress,
    appIndex: POLICY_APP_ID,
    appArgs,
    boxes: [{ appIndex: POLICY_APP_ID, name: boxName }],
    suggestedParams: sp,
  });
  return [call];
}

export function policyAppAddress(): string {
  return POLICY_APP_ADDRESS;
}
