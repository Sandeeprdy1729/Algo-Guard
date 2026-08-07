/**
 * In-process pub/sub for Server-Sent Events. One Node process only —
 * fine for the hackathon. No Redis.
 */
type Client = { id: number; controller: ReadableStreamDefaultController<Uint8Array> };

const clients = new Set<Client>();
let nextId = 1;
const encoder = new TextEncoder();

export interface Event {
  type: 'transaction' | 'approval' | 'policy' | 'audit' | 'ping';
  data: unknown;
}

export function subscribe(): ReadableStream<Uint8Array> {
  let self: Client;
  return new ReadableStream({
    start(controller) {
      self = { id: nextId++, controller };
      clients.add(self);
      controller.enqueue(encoder.encode(`: connected ${self.id}\n\n`));
    },
    cancel() {
      clients.delete(self);
    },
  });
}

export function emit(evt: Event) {
  const chunk = encoder.encode(`event: ${evt.type}\ndata: ${JSON.stringify(evt.data)}\n\n`);
  for (const c of clients) {
    try {
      c.controller.enqueue(chunk);
    } catch {
      clients.delete(c);
    }
  }
}

// Keep-alive ping every 20s (some proxies drop idle SSE).
setInterval(() => emit({ type: 'ping', data: { t: Date.now() } }), 20_000).unref();
