import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chatPost,
  approvalStatus,
  toJsonSchema,
  type AnnouncedTool,
} from '@agent-gateway/protocol';
import { openStore } from '../../src/store/store.js';
import { OfflineQueue } from '../../src/offline-queue/service.js';
import { LinkConnection, LinkRegistry } from '../../src/link/registry.js';
import { ToolsetStore } from '../../src/routing/toolsets.js';
import { QUEUE_CONFIG } from '../../src/offline-queue/repository.js';
const owner = { worldId: 'w', userId: 'u', agentId: 'a' };
const definition = (tool: typeof chatPost | typeof approvalStatus): AnnouncedTool => ({
  name: tool.name,
  description: tool.description,
  category: tool.category,
  minRole: tool.minRole,
  ...toJsonSchema(tool),
});
const pack: AnnouncedTool = {
  name: 'hello-write',
  description: 'fixture pack mutation',
  category: 'write',
  minRole: 'player',
  pack: { prefix: 'hello', id: 'hello', version: '1.0.0' },
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: { type: 'object', additionalProperties: false, properties: {} },
};
afterEach(() => vi.useRealTimers());
function setup() {
  const store = openStore(':memory:');
  store.createPairing({ id: 'a', worldId: 'w', userId: 'u', tokenHash: 'hash' });
  const registry = new LinkRegistry(),
    sets = new ToolsetStore(() => {}),
    sent: string[] = [];
  const c = new LinkConnection('c', 'a', 'w', 'u', { send: (s) => sent.push(s), close: () => {} });
  registry.add(c);
  const queue = new OfflineQueue(store, registry, sets);
  return {
    store,
    registry,
    sets,
    c,
    queue,
    sent,
    close: () => {
      queue.close();
      store.close();
    },
  };
}
describe('queue catalog and lifecycle fail closed', () => {
  it('admits accepted canonical core and pack arguments, never reads/unknown names/forged core', () => {
    const h = setup();
    h.sets.set(h.c, [definition(chatPost), definition(approvalStatus), pack], true);
    expect(h.queue.enqueue(owner, 's', 'chat_post', { content: 'fixture' }).state).toBe('queued');
    expect(h.queue.enqueue(owner, 's', pack.name, {}).state).toBe('queued');
    for (const [name, args] of [
      ['approval_status', { id: 'r' }],
      ['unseen_tool', {}],
      ['chat_post', { content: 2 }],
    ] as const)
      expect(() => h.queue.enqueue(owner, 's', name, args)).toThrow();
    h.sets.set(h.c, [{ ...definition(chatPost), category: 'read' }], true);
    expect(() => h.queue.enqueue(owner, 's', 'chat_post', { content: 'fixture' })).toThrow();
    h.close();
  });
  it('invalidates replay catalog even when online filtered definitions stay unchanged', () => {
    const h = setup();
    h.sets.set(h.c, [pack], true);
    expect(h.store.queue.catalog(owner)).toHaveLength(1);
    h.sets.set(h.c, [pack, { ...pack, name: 'bad-name', pack: undefined }], true);
    expect(h.store.queue.catalog(owner)).toBeUndefined();
    expect(() => h.queue.enqueue(owner, 's', pack.name, {})).toThrow();
    h.sets.set(h.c, [pack], true);
    expect(h.store.queue.catalog(owner)).toHaveLength(1);
    h.close();
  });
  it('rejects aborted admission and altered/replaced owner pins before commit', () => {
    const h = setup();
    h.sets.set(h.c, [definition(chatPost)], true);
    const abort = new AbortController();
    abort.abort();
    expect(() =>
      h.queue.enqueue(owner, 's', 'chat_post', { content: 'fixture' }, abort.signal),
    ).toThrow('aborted');
    expect(h.store.queue.queued(owner)).toEqual([]);
    expect(() => h.queue.owner({ worldId: 'other', userId: 'u' }, owner)).toThrow('mismatch');
    h.store.createPairing({ id: 'b', tokenHash: 'other', worldId: 'w', userId: 'u' });
    h.registry.remove(h.c);
    expect(() => h.queue.owner(owner)).toThrow('unambiguous');
    h.close();
  });
  it('owns one cleanup timer and removes listeners/timer cleanly', () => {
    vi.useFakeTimers();
    const h = setup();
    h.sets.set(h.c, [definition(chatPost)], true);
    h.queue.enqueue(owner, 's', 'chat_post', { content: 'fixture' });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(QUEUE_CONFIG.ttlMs + QUEUE_CONFIG.cleanupMs);
    expect(h.store.queue.queued(owner)).toEqual([]);
    h.queue.close();
    expect(vi.getTimerCount()).toBe(0);
    expect(h.sets.listenerCount('changed')).toBe(0);
    h.store.close();
  });
});
