/**
 * AgentGuard — x402 endpoint pricing.
 *
 * Two endpoints, two demo beats:
 *   POST /llm/summarize  → $0.01  USDC  (cheap  — normal policy + payment flow)
 *   POST /gpu/render     → $0.50  USDC  (expensive — triggers human escalation)
 *
 * The prices here MUST match apps/server/src/middleware/pricing.ts.
 */
import { ALGORAND_TESTNET_CAIP2, USDC_TESTNET_ASA_ID } from '@x402/avm';
import { declareDiscoveryExtension } from '@x402-avm/extensions';

export interface EndpointConfig {
  [key: string]: {
    accepts: Array<{
      scheme: 'exact';
      price: string;
      network: string;
      payTo: string;
      extra: { asset: number };
    }>;
    description: string;
    extensions?: Record<string, unknown>;
  };
}

export function createPaymentConfig(avmAddress: string): EndpointConfig {
  return {
    'POST /llm/summarize': {
      accepts: [
        {
          scheme: 'exact',
          price: '$0.01',
          network: ALGORAND_TESTNET_CAIP2,
          payTo: avmAddress,
          extra: { asset: Number(USDC_TESTNET_ASA_ID) },
        },
      ],
      description: 'Summarise arbitrary text with Claude — Pay $0.01 USDC per call',
      extensions: declareDiscoveryExtension({
        bodyType: 'json',
        input: { text: 'The full article body to summarise.' },
        inputSchema: {
          properties: {
            text: { type: 'string' },
            style: { type: 'string', enum: ['bullet', 'tldr', 'exec'] },
          },
          required: ['text'],
        },
        output: {
          example: {
            summary: 'Three-line summary of the input text.',
            model: 'claude-haiku-4-5',
            tokens: 128,
            paidVia: 'x402 / USDC Algorand Testnet / governed by AgentGuard',
          },
        },
      }),
    },

    'POST /gpu/render': {
      accepts: [
        {
          scheme: 'exact',
          price: '$0.50',
          network: ALGORAND_TESTNET_CAIP2,
          payTo: avmAddress,
          extra: { asset: Number(USDC_TESTNET_ASA_ID) },
        },
      ],
      description: 'Simulated GPU render job — Pay $0.50 USDC (triggers human approval)',
      extensions: declareDiscoveryExtension({
        bodyType: 'json',
        input: { prompt: 'A cinematic still of a cyberpunk city at dusk.' },
        inputSchema: {
          properties: {
            prompt: { type: 'string' },
            steps: { type: 'number' },
          },
          required: ['prompt'],
        },
        output: {
          example: {
            renderId: 'r_abc123',
            imageUrl: 'https://cdn.example.com/renders/r_abc123.png',
            gpuSeconds: 8.4,
            paidVia: 'x402 / USDC Algorand Testnet / governed by AgentGuard',
          },
        },
      }),
    },
  };
}

export default createPaymentConfig;
