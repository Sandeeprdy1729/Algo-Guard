/**
 * @agentguard/policy-sdk
 *
 * Tiny helper for calling AgentGuard-protected x402 endpoints.
 * Handles the 402 payment dance AND the escalation retry loop.
 */
export { makeAgentGuardClient } from './client.js';
export type { AgentGuardClient, AgentGuardResponse } from './client.js';
