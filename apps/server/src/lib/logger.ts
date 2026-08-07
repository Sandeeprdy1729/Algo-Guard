/**
 * Tiny JSON-line logger. Deliberately dependency-free so it works
 * in every deployment target (Node, edge, containers) without pulling
 * a heavy logger dependency for a hackathon-scale app.
 *
 * Output shape (one JSON object per line):
 *   {"t":"2026-01-01T00:00:00.000Z","lvl":"info","msg":"...","...":"..."}
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const CONFIGURED = (process.env.LOG_LEVEL as Level | undefined) ?? 'info';
const THRESHOLD = LEVEL_ORDER[CONFIGURED] ?? 20;
const PRETTY = process.env.LOG_PRETTY === '1' || process.env.NODE_ENV === 'development';

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < THRESHOLD) return;
  const record = {
    t: new Date().toISOString(),
    lvl: level,
    msg,
    ...(fields ?? {}),
  };
  if (PRETTY) {
    const tint =
      level === 'error' ? '\x1b[31m' : level === 'warn' ? '\x1b[33m' : level === 'debug' ? '\x1b[90m' : '\x1b[36m';
    const reset = '\x1b[0m';
    const extra = Object.keys(fields ?? {})
      .map((k) => `${k}=${JSON.stringify(fields![k])}`)
      .join(' ');
    console.log(`${tint}${level.toUpperCase().padEnd(5)}${reset} ${msg}${extra ? ' ' + extra : ''}`);
  } else {
    console.log(JSON.stringify(record));
  }
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
  child(bindings: Record<string, unknown>) {
    return {
      debug: (msg: string, f?: Record<string, unknown>) => emit('debug', msg, { ...bindings, ...(f ?? {}) }),
      info: (msg: string, f?: Record<string, unknown>) => emit('info', msg, { ...bindings, ...(f ?? {}) }),
      warn: (msg: string, f?: Record<string, unknown>) => emit('warn', msg, { ...bindings, ...(f ?? {}) }),
      error: (msg: string, f?: Record<string, unknown>) => emit('error', msg, { ...bindings, ...(f ?? {}) }),
    };
  },
};
