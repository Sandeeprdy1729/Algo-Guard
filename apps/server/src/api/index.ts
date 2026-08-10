/**
 * Dashboard REST + SSE routes. All under `/api/*` and NOT
 * payment-protected — policyMiddleware skips this prefix.
 */
import type { Hono } from 'hono';
import { agentsRouter } from './agents';
import { policiesRouter } from './policies';
import { auditRouter } from './audit';
import { approvalsRouter } from './approvals';
import { slackRouter } from './slack';
import { subscribe } from './stream';

export function mountDashboardApi(app: Hono<any>) {
  app.route('/api/agents', agentsRouter);
  app.route('/api/policies', policiesRouter);
  app.route('/api/audit', auditRouter);
  app.route('/api/approvals', approvalsRouter);
  app.route('/api/slack', slackRouter);

  app.get('/api/stream', (c) => {
    return new Response(subscribe(), {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
        connection: 'keep-alive',
      },
    });
  });
}
