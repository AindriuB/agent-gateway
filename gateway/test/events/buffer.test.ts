import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBuffer } from '../../src/events/buffer.js';
import { LinkConnection, LinkRegistry } from '../../src/link/registry.js';
import { ToolsetStore } from '../../src/routing/toolsets.js';
import { openStore } from '../../src/store/index.js';
const event = (seq = 1, userId = 'u') => ({
  seq,
  ts: 1,
  type: 'actor_update' as const,
  userId,
  summary: 'Actor updated',
});
describe('online event buffer authority and lifecycle', () => {
  let store: ReturnType<typeof openStore>,
    registry: LinkRegistry,
    sets: ToolsetStore,
    buffer: EventBuffer;
  const connection = (id = 'c', agentId = 'a', worldId = 'w', userId = 'u') => {
    if (!store.isPairingActive(agentId, worldId, userId))
      store.createPairing({ id: agentId, tokenHash: agentId, worldId, userId });
    const c = new LinkConnection(id, agentId, worldId, userId, { send() {}, close() {} });
    registry.add(c);
    buffer.connect(c);
    sets.set(c, [], true);
    return c;
  };
  beforeEach(() => {
    vi.useFakeTimers();
    store = openStore(':memory:');
    registry = new LinkRegistry();
    sets = new ToolsetStore();
    buffer = new EventBuffer(store, registry, sets, () => 100);
  });
  afterEach(() => {
    buffer.close();
    store.close();
    vi.useRealTimers();
  });
  it('rejects duplicate, old sequence, native gap and observer spoof without appending', async () => {
    const c = connection();
    buffer.accept(c, event(3));
    for (const e of [event(3), event(2), event(4, 'other'), { ...event(4), type: 'gap' }])
      expect(() => buffer.accept(c, e)).toThrow();
    expect((await buffer.poll(c, 's', 0, 100)).events).toHaveLength(1);
  });
  it('reconnects at source sequence1 and inserts exactly one known trailing gap', async () => {
    const old = connection();
    buffer.accept(old, event(1));
    const next = new LinkConnection('next', 'a', 'w', 'u', { send() {}, close() {} });
    registry.add(next);
    buffer.connect(next, { connectionId: 'c', lastSeq: 4 });
    sets.set(next, [], true);
    expect(() => buffer.accept(old, event(2))).toThrow('online');
    registry.remove(old);
    buffer.accept(next, event(1));
    const result = await buffer.poll(next, 's', 0, 100);
    expect(result.events.map((e) => e.cursor)).toEqual([1, 2, 3]);
    expect(result.events[1]?.event).toMatchObject({ type: 'gap', missed: 3 });
  });
  it('uses unknown after a restart or unrecognized resume and isolates replacement pairing', async () => {
    const c = connection();
    buffer.accept(c, event());
    buffer.close();
    buffer = new EventBuffer(store, registry, sets, () => 100);
    const d = connection('d');
    expect((await buffer.poll(d, 's', 0, 100)).events[1]?.event).toMatchObject({
      type: 'gap',
      missed: 'unknown',
    });
    store.revokePairing('a');
    const fresh = connection('fresh', 'b');
    const result = await buffer.poll(fresh, 's', 0, 100);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.event.type).toBe('gap');
  });
  it('allows independent nondestructive polls and preserves cursor on timeout', async () => {
    const c = connection();
    const one = buffer.poll(c, 'one', 0, 100),
      two = buffer.poll(c, 'two', 0, 100);
    expect(() => buffer.poll(c, 'one', 0, 100)).toThrow('one event poll');
    buffer.accept(c, event());
    expect(await one).toEqual(await two);
    expect(buffer.pendingCount).toBe(0);
    const timeout = buffer.poll(c, 'timeout', 1, 100);
    await vi.advanceTimersByTimeAsync(25000);
    expect(await timeout).toEqual({ events: [], nextAfter: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rechecks metadata-only policy changes and pairing revocation while waiting', async () => {
    const c = connection();
    const pending = buffer.poll(c, 's', 0, 100);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'FORBIDDEN' });
    sets.set(c, [], false);
    await rejected;
    expect(buffer.pendingCount).toBe(0);
    sets.set(c, [], true);
    const next = buffer.poll(c, 's', 0, 100);
    const revoked = expect(next).rejects.toMatchObject({ code: 'FORBIDDEN' });
    store.revokePairing('a');
    await revoked;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('caps waiting polls and releases capacity on cancel, session close and shutdown', async () => {
    const c = connection();
    const abort = new AbortController();
    const jobs = Array.from({ length: 64 }, (_, i) =>
      buffer.poll(c, String(i), 0, 100, i === 0 ? abort.signal : undefined).catch((e) => e.code),
    );
    expect(() => buffer.poll(c, 'extra', 0, 100)).toThrow('capacity');
    abort.abort();
    await Promise.resolve();
    expect(buffer.pendingCount).toBe(63);
    const replacement = buffer.poll(c, 'extra', 0, 100).catch((e) => e.code);
    buffer.cancelSession('1');
    expect(buffer.pendingCount).toBe(63);
    buffer.close();
    expect(await Promise.all(jobs)).toHaveLength(64);
    expect(await replacement).toBe('WORLD_OFFLINE');
    expect(buffer.pendingCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('exposes final authority revocation after a poll wake for response-time checks', async () => {
    const c = connection();
    const p = buffer.poll(c, 's', 0, 100);
    buffer.accept(c, event());
    sets.set(c, [], false);
    await p;
    expect(() => buffer.authorize(c)).toThrow('explicit allow');
  });
  it('disconnect rejects pending and missing announcement denies even an otherwise valid principal', async () => {
    const c = connection();
    sets.set(c, []);
    expect(() => buffer.poll(c, 's', 0, 100)).toThrow('explicit allow');
    sets.set(c, [], true);
    const p = buffer.poll(c, 's', 0, 100);
    const check = expect(p).rejects.toMatchObject({ code: 'WORLD_OFFLINE' });
    registry.remove(c);
    await check;
    expect(() => buffer.history(c)).toThrow();
    expect(buffer.pendingCount).toBe(0);
  });
});
