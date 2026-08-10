#!/usr/bin/env node
/**
 * AgentGuard MCP server.
 *
 * Exposes AgentGuard's policy engine to any MCP-capable client
 * (Claude Desktop, Cursor, IDE assistants) as a small set of tools.
 *
 * Design invariants — do not violate:
 *
 *   1. THIS SERVER IS A CLIENT. It talks to the AgentGuard HTTP API
 *      like any other frontend. It has NO direct Prisma / Postgres
 *      access, no signing keys, no access to secrets. Every action is
 *      one HTTP call to `AGENTGUARD_URL`.
 *
 *   2. POLICY IS NEVER BYPASSED. `simulate_policy` calls the server's
 *      /api/policies/simulate/:id — the exact same engine the runtime
 *      middleware uses. There is no local re-implementation of the
 *      rules here; if the engine changes, this tool updates for free.
 *
 *   3. WRITE ACTIONS (freeze / unfreeze / decide_approval) go through
 *      the same service layer as the dashboard and Slack. Idempotency,
 *      SecurityEvent recording, SSE emit, spend-cache invalidation —
 *      all handled server-side. This MCP tool is not a shortcut.
 *
 *   4. NO SECRETS IN RESPONSES. Wallet addresses are public. Approval
 *      IDs are opaque. We never surface Prisma internals, request IDs,
 *      env values, or connection strings.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

const BASE = (process.env.AGENTGUARD_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const ACTOR = process.env.AGENTGUARD_MCP_ACTOR ?? 'mcp';

// ── HTTP wrapper ──────────────────────────────────────────────────

interface ApiError {
  status: number;
  code?: string;
  message: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    throw new McpError(
      ErrorCode.InternalError,
      `AgentGuard server unreachable at ${BASE} (${(err as Error).message}). ` +
      `Set AGENTGUARD_URL if the server is not on localhost:8787.`,
    );
  }
  const text = await res.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!res.ok) {
    const e: ApiError = {
      status: res.status,
      code: body?.code,
      message: body?.error ?? `HTTP ${res.status} on ${path}`,
    };
    throw new McpError(
      res.status === 404 ? ErrorCode.InvalidRequest : ErrorCode.InternalError,
      `${e.message}${e.code ? ` [${e.code}]` : ''}`,
    );
  }
  return body as T;
}

// Format helpers — MCP responses are markdown text. Never dump raw
// JSON at the model unless it asks for it; keep the summary human.
const fmtUsdc = (micro: number) =>
  micro === 0 ? '$0'
  : micro < 1_000 ? `$${(micro / 1_000_000).toFixed(6)}`
  : micro < 100_000 ? `$${(micro / 1_000_000).toFixed(4)}`
  : `$${(micro / 1_000_000).toFixed(2)}`;

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

// ── Tool definitions ─────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_agents',
    description:
      'List all AgentGuard-managed agents with their current status and spending. ' +
      'Read-only. Safe to call any time.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_agent',
    description:
      'Fetch one agent by ID: policy, spend window, last 50 transactions.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent UUID' },
      },
      required: ['agentId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_timeline',
    description:
      "Chronological feed of an agent's behavior: transactions, approvals, " +
      'freeze/unfreeze events, policy updates. Useful for debugging why an ' +
      "agent's traffic changed.",
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        limit:   { type: 'number', minimum: 1, maximum: 200, default: 50 },
      },
      required: ['agentId'],
      additionalProperties: false,
    },
  },
  {
    name: 'simulate_policy',
    description:
      'Ask the AgentGuard engine what it WOULD decide for a hypothetical ' +
      'request, without spending USDC. Returns the decision (ALLOW/BLOCK/' +
      'ESCALATE), the primary rule that fired, and the full rule trace. ' +
      'Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId:        { type: 'string' },
        route:          { type: 'string', description: 'e.g. "POST /llm/summarize"' },
        amountMicroUsdc:{ type: 'number', description: 'Optional — defaults to the route\'s real price' },
        riskScore:      { type: 'number', minimum: 0, maximum: 100, description: 'Optional — override risk score' },
      },
      required: ['agentId', 'route'],
      additionalProperties: false,
    },
  },
  {
    name: 'freeze_agent',
    description:
      'Emergency kill-switch. Refuses every future x402 request from this ' +
      'agent until unfrozen. Idempotent — freezing a frozen agent is a no-op.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        reason:  { type: 'string', description: 'Short human-readable reason (recorded in the security-event log)' },
      },
      required: ['agentId'],
      additionalProperties: false,
    },
  },
  {
    name: 'unfreeze_agent',
    description:
      'Resume x402 payments from a previously-frozen agent. Idempotent.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        reason:  { type: 'string' },
      },
      required: ['agentId'],
      additionalProperties: false,
    },
  },
  {
    name: 'decide_approval',
    description:
      'Approve or deny a pending escalation. Goes through the same idempotent ' +
      'service the dashboard and Slack use — a second decision is a no-op.',
    inputSchema: {
      type: 'object',
      properties: {
        approvalId: { type: 'string' },
        decision:   { type: 'string', enum: ['approved', 'denied'] },
      },
      required: ['approvalId', 'decision'],
      additionalProperties: false,
    },
  },
];

// ── Tool handlers ────────────────────────────────────────────────

async function handleTool(name: string, args: any) {
  switch (name) {
    case 'list_agents':      return listAgents();
    case 'get_agent':        return getAgent(args.agentId);
    case 'get_timeline':     return getTimeline(args.agentId, args.limit ?? 50);
    case 'simulate_policy':  return simulatePolicy(args);
    case 'freeze_agent':     return setStatus(args.agentId, 'freeze', args.reason);
    case 'unfreeze_agent':   return setStatus(args.agentId, 'unfreeze', args.reason);
    case 'decide_approval':  return decideApproval(args.approvalId, args.decision);
    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}

async function listAgents() {
  const { agents } = await api<{ agents: any[] }>('/api/agents');
  if (agents.length === 0) return textResult('No agents registered.');
  const lines = agents.map((a) => {
    const spent = a.spend?.dailySpentMicroUsdc ?? 0;
    const cap = a.policy?.dailyCapMicroUsdc ?? 0;
    return `- ${a.name} · id=${a.id} · ${a.status.toUpperCase()} · ` +
      `daily ${fmtUsdc(spent)} / ${fmtUsdc(cap)} · ${a.algoAddress}`;
  });
  return textResult(`${agents.length} agent(s):\n${lines.join('\n')}`);
}

async function getAgent(agentId: string) {
  const a = await api<any>(`/api/agents/${encodeURIComponent(agentId)}`);
  const cap = a.policy?.dailyCapMicroUsdc ?? 0;
  const spent = a.spend?.dailySpentMicroUsdc ?? 0;
  const lines = [
    `# ${a.name}  (${a.status.toUpperCase()})`,
    `Algorand: ${a.algoAddress}`,
    `Daily:   ${fmtUsdc(spent)} / ${fmtUsdc(cap)}`,
    `Monthly: ${fmtUsdc(a.spend?.monthlySpentMicroUsdc ?? 0)} / ${fmtUsdc(a.policy?.monthlyCapMicroUsdc ?? 0)}`,
    `Human threshold: ${fmtUsdc(a.policy?.humanThresholdMicroUsdc ?? 0)}`,
    `Risk threshold:  ${a.policy?.riskThreshold ?? '—'}`,
    `Allowed routes:  ${(a.policy?.allowedRoutes ?? []).join(', ') || '(none)'}`,
    ``,
    `Recent transactions: ${a.transactions?.length ?? 0}`,
  ];
  return textResult(lines.join('\n'));
}

async function getTimeline(agentId: string, limit: number) {
  const r = await api<{ agent: any; entries: any[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/timeline?limit=${limit}`,
  );
  if (r.entries.length === 0) {
    return textResult(`No events for ${r.agent.name}.`);
  }
  const lines = r.entries.map((e) => {
    const when = new Date(e.at).toISOString();
    return `${when} · ${e.kind.toUpperCase().padEnd(11)} · ${e.tone.padEnd(7)} · ${e.summary}`;
  });
  return textResult(
    `${r.agent.name} (${r.agent.status}) — ${r.entries.length} events:\n${lines.join('\n')}`
  );
}

async function simulatePolicy(args: {
  agentId: string;
  route: string;
  amountMicroUsdc?: number;
  riskScore?: number;
}) {
  const body: Record<string, unknown> = { route: args.route };
  if (typeof args.amountMicroUsdc === 'number') body.amountMicroUsdc = args.amountMicroUsdc;
  if (typeof args.riskScore === 'number')       body.riskScore = args.riskScore;

  const r = await api<{
    agent: any;
    input: any;
    trace: {
      decision: 'ALLOW' | 'BLOCK' | 'ESCALATE';
      primaryCode: string;
      reason: string | null;
      spendingState: any;
      rules: Array<{ id: string; matched: boolean; severity: string; detail: string }>;
    };
  }>(`/api/policies/simulate/${encodeURIComponent(args.agentId)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const matched = r.trace.rules.filter((x) => x.matched);
  const lines = [
    `Decision: **${r.trace.decision}** (${r.trace.primaryCode})`,
    r.trace.reason ? `Reason: ${r.trace.reason}` : null,
    ``,
    `Route:  ${r.input.route}`,
    `Amount: ${fmtUsdc(r.input.amountMicroUsdc)}`,
    r.input.riskScore != null ? `Risk:   ${r.input.riskScore}` : null,
    ``,
    `Rules matched: ${matched.length}/${r.trace.rules.length}`,
    ...matched.map((m) => `  • [${m.severity}] ${m.id}: ${m.detail}`),
  ].filter(Boolean);
  return textResult(lines.join('\n'));
}

async function setStatus(agentId: string, action: 'freeze' | 'unfreeze', reason?: string) {
  const path = `/api/agents/${encodeURIComponent(agentId)}/${action}`;
  const r = await api<{ id: string; status: string; changed: boolean }>(path, {
    method: 'POST',
    body: JSON.stringify({ actor: ACTOR, reason: reason ?? null }),
  });
  return textResult(
    r.changed
      ? `Agent ${r.id} → ${r.status.toUpperCase()}. Actor: ${ACTOR}.`
      : `Agent ${r.id} already ${r.status.toUpperCase()} — no change.`
  );
}

async function decideApproval(approvalId: string, decision: 'approved' | 'denied') {
  const r = await api<{ ok: boolean; status: string; reason?: string }>(
    `/api/approvals/${encodeURIComponent(approvalId)}/decision`,
    {
      method: 'POST',
      body: JSON.stringify({
        decision,
        approverAddress: null,     // MCP does not sign on-chain
        approvalTxnId: null,
      }),
    },
  );
  return textResult(
    r.ok
      ? `Approval ${approvalId} → ${r.status.toUpperCase()}.`
      : `Approval ${approvalId} unchanged (${r.status}) — ${r.reason ?? 'idempotent no-op'}.`
  );
}

// ── Boot ─────────────────────────────────────────────────────────

async function main() {
  const server = new Server(
    { name: 'agentguard-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      return await handleTool(name, args ?? {});
    } catch (err) {
      if (err instanceof McpError) throw err;
      throw new McpError(
        ErrorCode.InternalError,
        `${name} failed: ${(err as Error).message}`,
      );
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`agentguard-mcp connected to ${BASE}\n`);
}

main().catch((err) => {
  process.stderr.write(`agentguard-mcp fatal: ${err?.message ?? err}\n`);
  process.exit(1);
});
