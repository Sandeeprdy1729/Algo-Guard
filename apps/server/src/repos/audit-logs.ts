import type { PrismaClient } from '@prisma/client';
import { prisma } from '../chain/prisma';
import type { AuditLogDto } from './types';

export const auditLogsRepo = {
  async list(limit = 50, db: PrismaClient = prisma): Promise<AuditLogDto[]> {
    const rows = await db.auditLog.findMany({
      orderBy: { id: 'desc' },
      take: Math.min(200, limit),
    });
    return rows.map((r) => ({
      id: r.id.toString(),
      round: r.round.toString(),
      algoTxnId: r.algoTxnId,
      eventType: r.eventType,
      agentAddress: r.agentAddress,
      payload: r.payload,
      createdAt: r.createdAt.toISOString(),
    }));
  },
};
