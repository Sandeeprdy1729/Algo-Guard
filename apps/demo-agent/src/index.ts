/**
 * AgentGuard demo agent — CLI entrypoint.
 *
 *   pnpm --filter @agentguard/demo-agent start happy
 *   pnpm --filter @agentguard/demo-agent start risky
 *   pnpm --filter @agentguard/demo-agent start escalate
 */
import { config } from 'dotenv';
import { loadWallet } from './wallet.js';
import { makeClient } from './client.js';
import { run as happy } from './scenarios/happy.js';
import { run as risky } from './scenarios/risky.js';
import { run as escalate } from './scenarios/escalate.js';

config();

const SERVER = process.env.SERVER_URL ?? 'http://localhost:4021';
const MNEMONIC = process.env.AGENT_MNEMONIC;
const ACCOUNT_INDEX = parseInt(process.env.ACCOUNT_INDEX ?? '0', 10);

if (!MNEMONIC) {
  console.error(
    'AGENT_MNEMONIC missing — put a 25-word Algorand mnemonic OR a 24-word ' +
      'BIP-39 (Pera Universal Wallet) phrase in .env'
  );
  process.exit(1);
}

const scenario = (process.argv[2] ?? 'happy').toLowerCase();
const wallet = loadWallet(MNEMONIC, { accountIndex: ACCOUNT_INDEX });
const client = makeClient(SERVER, wallet);

console.log('═'.repeat(60));
console.log(`agent wallet:  ${wallet.address}`);
console.log(`mnemonic:      ${wallet.format}${wallet.hdPath ? ` @ ${wallet.hdPath}` : ''}`);
console.log(`server:        ${SERVER}`);
console.log(`scenario:      ${scenario}`);
console.log('═'.repeat(60));

const runners: Record<string, (c: ReturnType<typeof makeClient>) => Promise<void>> = {
  happy,
  risky,
  escalate,
};

const fn = runners[scenario];
if (!fn) {
  console.error(`unknown scenario "${scenario}". choose one of: ${Object.keys(runners).join(', ')}`);
  process.exit(2);
}

fn(client).catch((err) => {
  console.error('scenario failed:', err);
  process.exit(3);
});
