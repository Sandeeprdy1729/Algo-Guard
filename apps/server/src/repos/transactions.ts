import type { PrismaClient, Transaction as PTx, TransactionStatus } from '@prisma/client';
import { prisma } from '../chain/prisma';
import type { TransactionDto } from './types';

export type NewTransaction = {
  agentId: string;
  route: string;
  amountMicroUsdc: number;
  status: TransactionStatus;
  riskScore?: number | null;
  riskReason?: string | null;
  algoTxnId?: string | null;
  algoGroupId?: string | null;
  latencyMs?: number | null;
  settledAt?: Date | null;
};

function serialize(t: PTx & { agent?: { name: string; algoAddress: string } }): TransactionDto {
  return {
    id: t.id,
    agentId: t.agentId,
    agentName: t.agent?.name,
    agentAddress: t.agent?.algoAddress,
    route: t.route,
    amountMicroUsdc: Number(t.amountMicroUsdc),
    status: t.status,
    riskScore: t.riskScore,
    riskReason: t.riskReason,
    algoTxnId: t.algoTxnId,
    algoGroupId: t.algoGroupId,
    latencyMs: t.latencyMs,
    createdAt: t.createdAt.toISOString(),
    settledAt: t.settledAt?.toISOString() ?? null,
  };
}

export const transactionsRepo = {
  async create(input: NewTransaction, db: PrismaClient = prisma) {
    return db.transaction.create({
      data: {
        agentId: input.agentId,
        route: input.route,
        amountMicroUsdc: BigInt(input.amountMicroUsdc),
        status: input.status,
        riskScore: input.riskScore ?? null,
        riskReason: input.riskReason ?? null,
        algoTxnId: input.algoTxnId ?? null,
        algoGroupId: input.algoGroupId ?? null,
        latencyMs: input.latencyMs ?? null,
        settledAt: input.settledAt ?? null,
      },
    });
  },

  async list(
    filters: { agentId?: string; status?: TransactionStatus; limit?: number } = {},
    db: PrismaClient = prisma
  ) {
    const rows = await db.transaction.findMany({
      where: {
        agentId: filters.agentId,
        ...(filters.status ? { status: filters.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, filters.limit ?? 50),
      include: { agent: { select: { name: true, algoAddress: true } } },
    });
    return rows.map(serialize);
  },

  async spendWindow(
    agentId: string,
    day: Date,
    month: Date,
    db: PrismaClient = prisma
  ): Promise<{ dailyMicro: number; monthlyMicro: number }> {
    const [d, m] = await Promise.all([
      db.transaction.aggregate({
        where: { agentId, status: 'settled', settledAt: { gte: day } },
        _sum: { amountMicroUsdc: true },
      }),
      db.transaction.aggregate({
        where: { agentId, status: 'settled', settledAt: { gte: month } },
        _sum: { amountMicroUsdc: true },
      }),
    ]);
    return {
      dailyMicro: Number(d._sum.amountMicroUsdc ?? 0n),
      monthlyMicro: Number(m._sum.amountMicroUsdc ?? 0n),
    };
  },

  serialize,
};
