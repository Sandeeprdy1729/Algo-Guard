import type { PrismaClient } from '@prisma/client';
import { prisma } from '../chain/prisma';
import type { Policy } from '../policy/schema';

export const policiesRepo = {
  async upsertFor(
    agentId: string,
    policy: Policy,
    updatedTxnId: string | null,
    db: PrismaClient = prisma
  ) {
    return db.policy.upsert({
      where: { agentId },
      create: {
        agentId,
        dailyCapMicroUsdc: BigInt(policy.dailyCapMicroUsdc),
        monthlyCapMicroUsdc: BigInt(policy.monthlyCapMicroUsdc),
        humanThresholdMicroUsdc: BigInt(policy.humanThresholdMicroUsdc),
        allowedRoutes: policy.allowedRoutes,
        riskThreshold: policy.riskThreshold,
        updatedTxnId,
      },
      update: {
        dailyCapMicroUsdc: BigInt(policy.dailyCapMicroUsdc),
        monthlyCapMicroUsdc: BigInt(policy.monthlyCapMicroUsdc),
        humanThresholdMicroUsdc: BigInt(policy.humanThresholdMicroUsdc),
        allowedRoutes: policy.allowedRoutes,
        riskThreshold: policy.riskThreshold,
        updatedTxnId,
      },
    });
  },
};
