/**
 * Typed application errors with stable HTTP status codes and a
 * machine-readable `code` for clients.
 */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'MISSING_AGENT_HEADER'
  | 'UNKNOWN_AGENT'
  | 'POLICY_BLOCKED'
  | 'RISK_BLOCKED'
  | 'ESCALATION_REQUIRED'
  | 'AI_UNAVAILABLE'
  | 'CHAIN_UNAVAILABLE'
  | 'INTERNAL';

export class AppError extends Error {
  status: number;
  code: ErrorCode;
  details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, status = 400, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON(requestId?: string) {
    return {
      error: this.message,
      code: this.code,
      ...(this.details ?? {}),
      ...(requestId ? { requestId } : {}),
    };
  }
}

export function badRequest(msg: string, details?: Record<string, unknown>) {
  return new AppError('BAD_REQUEST', msg, 400, details);
}
export function notFound(msg: string) {
  return new AppError('NOT_FOUND', msg, 404);
}
