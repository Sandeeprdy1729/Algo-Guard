/**
 * setAgentStatus — the single freeze / unfreeze code path.
 *
 * Guarantees:
 *   - Idempotent: repeat freeze / repeat unfreeze does not fire another
 *     SecurityEvent and does not emit an SSE tick.
 *   - Writes exactly one SecurityEvent per real transition.
 *   - Invalidates the agent's spend cache (frozen state must be
 *     picked up by the next policy evaluation).
 *   - Broadcasts on SSE so the dashboard reflects the change live.
 *   - Any caller (dashboard, Slack, MCP, admin CLI) reaches the same
 *     invariants — no bypass path.
 */
import { agentsRepo, securityEventsRepo } from '../repos';
import { invalidateSpendWindow } from '../policy/spend';
import { emit } from '../api/stream';
import { log } from '../lib/logger';
import { notFound } from '../lib/errors';

export type StatusResult =
  | { status: 'changed'; agent: { id: string; status: 'active' | 'frozen' } }
  | { status: 'noop';    agent: { id: string; status: 'active' | 'frozen' } };

export interface StatusOptions {
  actor?: string | null;   // e.g. "dashboard", "slack:@alice", "mcp"
  reason?: string | null;
  requestId?: string;
}

export async function setAgentStatus(
  agentId: string,
  desired: 'active' | 'frozen',
  opts: StatusOptions = {},
): Promise<StatusResult> {
  const current = await agentsRepo.findById(agentId);
  if (!current) throw notFound(`agent ${agentId} not found`);

  if (current.status === desired) {
    log.info('agent.status.noop', {
      requestId: opts.requestId,
      agentId,
      status: desired,
    });
    return { status: 'noop', agent: { id: current.id, status: current.status } };
  }

  const updated = await agentsRepo.setStatus(agentId, desired);
  invalidateSpendWindow(agentId);
  await securityEventsRepo.create({
    agentId,
    type: desired === 'frozen' ? 'freeze' : 'unfreeze',
    actor: opts.actor ?? null,
    reason: opts.reason ?? null,
  });

  emit({
    type: 'agent',
    data: { id: updated.id, status: updated.status },
  });
  emit({
    type: 'security',
    data: {
      agentId,
      type: desired === 'frozen' ? 'freeze' : 'unfreeze',
      actor: opts.actor ?? null,
    },
  });

  log.info('agent.status.changed', {
    requestId: opts.requestId,
    agentId,
    from: current.status,
    to: desired,
    actor: opts.actor,
  });

  return { status: 'changed', agent: { id: updated.id, status: updated.status } };
}
