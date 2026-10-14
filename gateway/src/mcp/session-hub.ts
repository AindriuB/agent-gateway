import type { EventEmitter } from 'node:events';

type Handler = (...args: never[]) => void;

interface Fanout {
  handlers: Set<Handler>;
  dispatch: (...args: unknown[]) => void;
}

/** One emitter listener per (emitter, event), however many sessions subscribe. */
const hubs = new WeakMap<EventEmitter, Map<string, Fanout>>();

/**
 * Subscribe `handler` to `event` through a single shared listener on `emitter`, so the emitter's
 * listener count does not grow with the number of live sessions. Returns the unsubscribe; the
 * shared listener is removed when the last handler leaves.
 */
export function subscribe<A extends unknown[]>(
  emitter: EventEmitter,
  event: string,
  handler: (...args: A) => void,
): () => void {
  let events = hubs.get(emitter);
  if (!events) hubs.set(emitter, (events = new Map()));
  let fan = events.get(event);
  if (!fan) {
    const handlers = new Set<Handler>();
    const created: Fanout = {
      handlers,
      dispatch: (...args) => {
        for (const h of [...handlers]) (h as (...a: unknown[]) => void)(...args);
      },
    };
    emitter.on(event, created.dispatch);
    events.set(event, (fan = created));
  }
  const h = handler as unknown as Handler;
  fan.handlers.add(h);
  const owner = fan;
  return () => {
    if (!owner.handlers.delete(h) || owner.handlers.size > 0) return;
    if (events.get(event) !== owner) return;
    emitter.off(event, owner.dispatch);
    events.delete(event);
  };
}
