/**
 * AgentGuard server entrypoint.
 *
 * All wiring lives in ./app.ts so tests can boot the same Hono app
 * in-process without opening a socket. This file only handles:
 *   - loading env / validating required vars
 *   - creating the HTTP listener
 *   - kicking off the background indexer
 *   - graceful shutdown on SIGINT/SIGTERM
 */
import { config } from 'dotenv';
import { serve, type ServerType } from '@hono/node-server';
import { createApp } from './app';
import { startIndexer } from './chain/indexer';
import { log } from './lib/logger';

config();

const avmAddress = process.env.AVM_ADDRESS;
const facilitatorUrl = process.env.FACILITATOR_URL;
const port = parseInt(process.env.PORT || '4021', 10);

if (!avmAddress || !facilitatorUrl) {
  log.error('boot.missing_env', {
    hint: 'Required: AVM_ADDRESS + FACILITATOR_URL. See apps/server/.env.example.',
  });
  process.exit(1);
}

const { app, paymentConfig } = createApp({ avmAddress, facilitatorUrl });

log.info('boot.starting', {
  service: 'agentguard-server',
  version: '0.1.0',
  receiver: avmAddress,
  facilitator: facilitatorUrl,
  port,
  endpoints: Object.entries(paymentConfig).map(([route, cfg]) => ({
    route,
    price: cfg.accepts[0].price,
  })),
});

const server: ServerType = serve({ fetch: app.fetch, port }, () => {
  log.info('boot.listening', { url: `http://localhost:${port}` });
});

startIndexer().catch((err) =>
  log.warn('indexer.startup_failed', { msg: (err as Error).message })
);

// ── Graceful shutdown ────────────────────────────────────────────
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutdown.received', { signal });
  server.close(() => {
    log.info('shutdown.complete');
    process.exit(0);
  });
  // Hard-exit after 10s so a hung client can't stall the process forever.
  setTimeout(() => {
    log.warn('shutdown.forced');
    process.exit(1);
  }, 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  log.error('uncaughtException', { msg: err.message, stack: err.stack });
  // Bind failures and other fatal errors must terminate; a stalled
  // handler would keep the process alive while broken.
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') process.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
  log.error('unhandledRejection', {
    msg: reason instanceof Error ? reason.message : String(reason),
  });
});
