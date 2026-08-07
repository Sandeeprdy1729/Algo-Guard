import { Hono } from 'hono';
import { agentsRepo } from '../repos';
import { getSpendWindow, invalidateSpendWindow } from '../policy/spend';
import { allProtectedRoutes } from '../middleware/pricing';
import { badRequest, notFound } from '../lib/errors';
import { transactionsRepo } from '../repos';

export const agentsRouter = new Hono();

/** GET /api/agents — list with live spend + available routes. */
agentsRouter.get('/', async (c) => {
  const agents = await agentsRepo.list();
  const enriched = await Promise.all(
    agents.map(async (a) => ({
      ...a,
      spend: await getSpendWindow(a.id),
    }))
  );
  return c.json({ agents: enriched, availableRoutes: allProtectedRoutes() });
});

/** GET /api/agents/:id — detail + last 50 transactions. */
agentsRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const raw = await agentsRepo.findById(id);
  if (!raw) throw notFound(`agent ${id} not found`);
  const dto = agentsRepo.serialize(raw);
  const transactions = await transactionsRepo.list({ agentId: id, limit: 50 });
  const spend = await getSpendWindow(id);
  return c.json({ ...dto, transactions, spend });
});

/** POST /api/agents — register a new agent (dashboard admin action). */
agentsRouter.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const required = ['userEmail', 'adminAddress', 'name', 'algoAddress'] as const;
  for (const k of required) {
    if (typeof body[k] !== 'string' || !body[k]) throw badRequest(`missing ${k}`);
  }
  if (body.algoAddress.length !== 58) throw badRequest('algoAddress must be 58 characters');
  const agent = await agentsRepo.create({
    userEmail: body.userEmail,
    orgName: body.orgName ?? null,
    adminAddress: body.adminAddress,
    name: body.name,
    algoAddress: body.algoAddress,
    metadata: body.metadata,
  });
  return c.json({ id: agent.id, algoAddress: agent.algoAddress }, 201);
});

agentsRouter.post('/:id/freeze', async (c) => {
  const a = await agentsRepo.setStatus(c.req.param('id'), 'frozen');
  invalidateSpendWindow(a.id);
  return c.json({ id: a.id, status: a.status });
});

agentsRouter.post('/:id/unfreeze', async (c) => {
  const a = await agentsRepo.setStatus(c.req.param('id'), 'active');
  invalidateSpendWindow(a.id);
  return c.json({ id: a.id, status: a.status });
});
