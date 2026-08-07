import type { PrismaClient, Agent as PAgent, Policy as PPolicy } from '@prisma/client';
import { prisma } from '../chain/prisma';
import { notFound } from '../lib/errors';
import type { AgentDto, PolicyDto } from './types';

function serializePolicy(p: PPolicy): PolicyDto {
  return {
    dailyCapMicroUsdc: Number(p.dailyCapMicroUsdc),
    monthlyCapMicroUsdc: Number(p.monthlyCapMicroUsdc),
    humanThresholdMicroUsdc: Number(p.humanThresholdMicroUsdc),
    allowedRoutes: p.allowedRoutes,
    riskThreshold: p.riskThreshold,
    updatedTxnId: p.updatedTxnId,
    updatedAt: p.updatedAt.toISOString(),
  };
}

function serializeAgent(a: PAgent & { policy?: PPolicy | null }): AgentDto {
  return {
    id: a.id,
    name: a.name,
    algoAddress: a.algoAddress,
    status: a.status,
    metadata: a.metadata,
    createdAt: a.createdAt.toISOString(),
    policy: a.policy ? serializePolicy(a.policy) : null,
  };
}

export const agentsRepo = {
  async list(db: PrismaClient = prisma): Promise<AgentDto[]> {
    const rows = await db.agent.findMany({
      include: { policy: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(serializeAgent);
  },

  async findById(id: string, db: PrismaClient = prisma) {
    return db.agent.findUnique({ where: { id }, include: { policy: true } });
  },

  async findByAddress(algoAddress: string, db: PrismaClient = prisma) {
    return db.agent.findUnique({
      where: { algoAddress },
      include: { policy: true },
    });
  },

  async requireById(id: string, db: PrismaClient = prisma) {
    const a = await this.findById(id, db);
    if (!a) throw notFound(`agent ${id} not found`);
    return a;
  },

  async create(
    input: {
      userEmail: string;
      orgName?: string | null;
      adminAddress: string;
      name: string;
      algoAddress: string;
      metadata?: unknown;
    },
    db: PrismaClient = prisma
  ) {
    const user = await db.user.upsert({
      where: { email: input.userEmail },
      create: {
        email: input.userEmail,
        orgName: input.orgName ?? null,
        algoAdminAddress: input.adminAddress,
      },
      update: {
        algoAdminAddress: input.adminAddress,
        orgName: input.orgName ?? undefined,
      },
    });
    return db.agent.create({
      data: {
        userId: user.id,
        name: input.name,
        algoAddress: input.algoAddress,
        metadata: (input.metadata ?? {}) as any,
      },
    });
  },

  async setStatus(id: string, status: 'active' | 'frozen', db: PrismaClient = prisma) {
    return db.agent.update({ where: { id }, data: { status } });
  },

  serialize: serializeAgent,
  serializePolicy,
};
