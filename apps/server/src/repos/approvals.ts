import type { PrismaClient, ApprovalStatus } from '@prisma/client';
import { prisma } from '../chain/prisma';
import { notFound } from '../lib/errors';
import type { ApprovalDto } from './types';

function serialize(
  a: any // Approval + { transaction: { agent: {...} } }
): ApprovalDto {
  return {
    id: a.id,
    status: a.status,
    expiresAt: a.expiresAt.toISOString(),
    createdAt: a.createdAt.toISOString(),
    decidedAt: a.decidedAt?.toISOString() ?? null,
    approvalTxnId: a.approvalTxnId,
    transaction: {
      id: a.transaction.id,
      route: a.transaction.route,
      amountMicroUsdc: Number(a.transaction.amountMicroUsdc),
      agentName: a.transaction.agent.name,
      agentAddress: a.transaction.agent.algoAddress,
      riskScore: a.transaction.riskScore,
      riskReason: a.transaction.riskReason,
    },
  };
}

export const approvalsRepo = {
  async createPending(
    transactionId: string,
    ttlMs: number,
    db: PrismaClient = prisma
  ) {
    return db.approval.create({
      data: {
        transactionId,
        status: 'pending',
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
  },

  async findById(id: string, db: PrismaClient = prisma) {
    return db.approval.findUnique({
      where: { id },
      include: { transaction: { include: { agent: true } } },
    });
  },

  async requireById(id: string, db: PrismaClient = prisma) {
    const a = await this.findById(id, db);
    if (!a) throw notFound(`approval ${id} not found`);
    return a;
  },

  async listPending(db: PrismaClient = prisma) {
    const rows = await db.approval.findMany({
      where: { status: 'pending' },
      include: { transaction: { include: { agent: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(serialize);
  },

  async listByStatus(status: ApprovalStatus, db: PrismaClient = prisma) {
    const rows = await db.approval.findMany({
      where: { status },
      include: { transaction: { include: { agent: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(serialize);
  },

  async listByAgent(agentId: string, limit = 100, db: PrismaClient = prisma) {
    const rows = await db.approval.findMany({
      where: { transaction: { agentId } },
      include: { transaction: { include: { agent: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, limit),
    });
    return rows.map(serialize);
  },

  async decide(
    id: string,
    decision: 'approved' | 'denied',
    approverAddress: string | null,
    approvalTxnId: string | null,
    db: PrismaClient = prisma
  ) {
    return db.approval.update({
      where: { id },
      data: {
        status: decision,
        approverAddress,
        approvalTxnId,
        decidedAt: new Date(),
      },
      include: { transaction: true },
    });
  },

  /**
   * Save the Slack message coordinates so we can edit the same message
   * when the decision comes in. Best-effort — never throws.
   */
  async attachSlackMessage(
    id: string,
    channelId: string,
    messageTs: string,
    db: PrismaClient = prisma
  ) {
    return db.approval.update({
      where: { id },
      data: { slackChannelId: channelId, slackMessageTs: messageTs },
    });
  },

  serialize,
};
