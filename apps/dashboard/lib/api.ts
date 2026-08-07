export class ApiError extends Error {
  status: number;
  code?: string;
  requestId?: string;
  body?: unknown;

  constructor(msg: string, opts: { status: number; code?: string; requestId?: string; body?: unknown }) {
    super(msg);
    this.status = opts.status;
    this.code = opts.code;
    this.requestId = opts.requestId;
    this.body = opts.body;
  }
}

async function handle<T>(r: Response, path: string): Promise<T> {
  const text = await r.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!r.ok) {
    const b = body as any;
    throw new ApiError(b?.error ?? `${path} failed`, {
      status: r.status,
      code: b?.code,
      requestId: b?.requestId ?? r.headers.get('x-request-id') ?? undefined,
      body,
    });
  }
  return body as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(path, { cache: 'no-store' });
  return handle<T>(r, path);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handle<T>(r, path);
}

export function fmtUsdc(micro: number): string {
  if (micro === 0) return '$0';
  if (micro < 1_000) return `$${(micro / 1_000_000).toFixed(6)}`;
  if (micro < 100_000) return `$${(micro / 1_000_000).toFixed(4)}`;
  return `$${(micro / 1_000_000).toFixed(2)}`;
}

export function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function relTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s.toFixed(0)}s ago`;
  if (s < 3600) return `${(s / 60).toFixed(0)}m ago`;
  if (s < 86400) return `${(s / 3600).toFixed(0)}h ago`;
  return `${(s / 86400).toFixed(0)}d ago`;
}
