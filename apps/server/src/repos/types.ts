/**
 * DTOs the repository layer returns. All BigInts collapsed to Number
 * (JavaScript-safe up to 9_007_199 USDC — way more than we need) and
 * all Dates serialized to ISO strings so API routes can send them
 * without additional transformation.
 */
export interface AgentDto {
  id: string;
  name: string;
  algoAddress: string;
  status: 'active' | 'frozen';
  metadata: unknown;
  createdAt: string;
  policy: PolicyDto | null;
}

export interface PolicyDto {
  dailyCapMicroUsdc: number;
  monthlyCapMicroUsdc: number;
  humanThresholdMicroUsdc: number;
  allowedRoutes: string[];
  riskThreshold: number;
  updatedTxnId: string | null;
  updatedAt: string;
}

export interface TransactionDto {
  id: string;
  agentId: string;
  agentName?: string;
  agentAddress?: string;
  route: string;
  amountMicroUsdc: number;
  status: string;
  riskScore: number | null;
  riskReason: string | null;
  algoTxnId: string | null;
  algoGroupId: string | null;
  latencyMs: number | null;
  createdAt: string;
  settledAt: string | null;
}

export interface ApprovalDto {
  id: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  expiresAt: string;
  createdAt: string;
  decidedAt: string | null;
  approvalTxnId: string | null;
  transaction: {
    id: string;
    route: string;
    amountMicroUsdc: number;
    agentName: string;
    agentAddress: string;
    riskScore: number | null;
    riskReason: string | null;
  };
}

export interface AuditLogDto {
  id: string;
  round: string;
  algoTxnId: string | null;
  eventType: string;
  agentAddress: string | null;
  payload: unknown;
  createdAt: string;
}
