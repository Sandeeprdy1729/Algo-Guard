/**
 * Re-export the Hono Env type from the request-context middleware so
 * every module has a single source of truth for context variable
 * typing.
 */
export type { Env, RequestCtx } from './middleware/request-context';
