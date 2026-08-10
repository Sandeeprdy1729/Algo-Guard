import type { PrismaClient } from '@prisma/client';
import { prisma } from '../chain/prisma';

export interface SecurityEventDto {
  id: string;
  agentId: string;
  type: string;
  actor: string | null;
  reason: string | null;
  metadata: unknown;
  createdAt: string;
}

function serialize(row: {
  id: string;
  agentId: string;
  type: string;
  actor: string | null;
  reason: string | null;
  metadata: unknown;
  createdAt: Date;
}): SecurityEventDto {
  return {
    id: row.id,
    agentId: row.agentId,
    type: row.type,
    actor: row.actor,
    reason: row.reason,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

export const securityEventsRepo = {
  async create(
    input: {
      agentId: string;
      type: string;
      actor?: string | null;
      reason?: string | null;
      metadata?: unknown;
    },
    db: PrismaClient = prisma,
  ) {
    return db.securityEvent.create({
      data: {
        agentId: input.agentId,
        type: input.type,
        actor: input.actor ?? null,
        reason: input.reason ?? null,
        metadata: (input.metadata ?? null) as any,
      },
    });
  },

  async listByAgent(agentId: string, limit = 100, db: PrismaClient = prisma) {
    const rows = await db.securityEvent.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, limit),
    });
    return rows.map(serialize);
  },

  serialize,
};
