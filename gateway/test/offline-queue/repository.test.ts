import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../../src/store/store.js';
import { QUEUE_CONFIG } from '../../src/offline-queue/repository.js';
import type { AnnouncedTool } from '@agent-gateway/protocol';
const owner = { worldId: 'w', userId: 'u', agentId: 'a' };
const definition: AnnouncedTool = {
  name: 'document_update',
  category: 'write',
  minRole: 'player',
  description: 'update',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: { type: 'object', properties: {}, additionalProperties: false },
};
describe('durable offline queue', () => {
  it('bounds global nonterminal and total retained receipts', () => {
    const s = openStore(':memory:');
    for (let i = 0; i < QUEUE_CONFIG.global; i++)
      s.queue.enqueue({ ...owner, agentId: String(i) }, 's', definition, {}, 1);
    expect(() => s.queue.enqueue({ ...owner, agentId: 'extra' }, 's', definition, {}, 1)).toThrow(
      'capacity',
    );
    s.queue.cleanup(QUEUE_CONFIG.ttlMs + 1);
    for (let i = 0; i < QUEUE_CONFIG.global; i++)
      s.queue.enqueue(
        { ...owner, agentId: String(i) },
        's',
        definition,
        {},
        QUEUE_CONFIG.ttlMs + 2,
      );
    expect(() =>
      s.queue.enqueue({ ...owner, agentId: 'new' }, 's', definition, {}, QUEUE_CONFIG.ttlMs + 2),
    ).toThrow('capacity');
    s.close();
  });
  it.each(['claimed', 'pending'] as const)(
    'retires %s at deadline as unknown without resending',
    (state) => {
      const s = openStore(':memory:'),
        r = s.queue.enqueue(owner, 's', definition, {}, 10);
      s.queue.claim(owner, r.id, 'c');
      if (state === 'pending') s.queue.status(owner, r.id, 'c', 'pending', 'waiting', 11);
      s.queue.cleanup(10 + QUEUE_CONFIG.ttlMs);
      expect(s.queue.get(owner, r.id)?.state).toBe('unknown');
      expect(s.queue.queued(owner)).toEqual([]);
      expect(s.queue.status(owner, r.id, 'c', 'approved', 'late', 11 + QUEUE_CONFIG.ttlMs)).toBe(
        true,
      );
      expect(s.queue.get(owner, r.id)?.state).toBe('unknown');
      s.close();
    },
  );
  it('includes definition bytes in the individual delivery frame bound', () => {
    const s = openStore(':memory:');
    expect(() =>
      s.queue.enqueue(owner, 's', definition, { x: 'x'.repeat(1024 * 1024) }, 1),
    ).toThrow('frame limit');
    s.close();
  });
  it('retains intent across reopen, isolates every owner dimension and never replays a claimed receipt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'queue-')),
      path = join(dir, 'q.sqlite');
    let s = openStore(path);
    const r = s.queue.enqueue(owner, 'session', definition, {}, 100);
    s.queue.setCatalog(owner, [definition]);
    s.close();
    s = openStore(path);
    expect(s.queue.get(owner, r.id)?.state).toBe('queued');
    for (const other of [
      { ...owner, worldId: 'x' },
      { ...owner, userId: 'x' },
      { ...owner, agentId: 'x' },
    ])
      expect(s.queue.get(other, r.id)).toBeUndefined();
    expect(s.queue.claim(owner, r.id, 'c')).toBe(true);
    expect(s.queue.claim(owner, r.id, 'c')).toBe(false);
    s.close();
    s = openStore(path);
    s.queue.recover(200);
    expect(s.queue.get(owner, r.id)?.state).toBe('unknown');
    expect(s.queue.queued(owner)).toEqual([]);
    expect(s.queue.catalog(owner)).toEqual([definition]);
    s.close();
    rmSync(dir, { recursive: true });
  });
  it('enforces owner cap transactionally without inserting excess work', () => {
    const s = openStore(':memory:');
    for (let i = 0; i < 20; i++) s.queue.enqueue(owner, 's', definition, {}, 1);
    expect(() => s.queue.enqueue(owner, 's', definition, {}, 1)).toThrow('capacity');
    expect(s.queue.queued(owner)).toHaveLength(5);
    s.close();
  });
  it('expires only on receipt deadline and retains then removes terminal receipts', () => {
    const s = openStore(':memory:');
    const r = s.queue.enqueue(owner, 's', definition, {}, 10);
    s.queue.cleanup(10 + QUEUE_CONFIG.ttlMs - 1);
    expect(s.queue.get(owner, r.id)?.state).toBe('queued');
    s.queue.cleanup(10 + QUEUE_CONFIG.ttlMs);
    expect(s.queue.get(owner, r.id)?.state).toBe('expired');
    s.queue.cleanup(11 + QUEUE_CONFIG.ttlMs + QUEUE_CONFIG.retainMs);
    expect(s.queue.get(owner, r.id)).toBeUndefined();
    s.close();
  });
  it('rejects stale connection replies, immutable terminal rewrites and cross-owner completion', () => {
    const s = openStore(':memory:');
    const r = s.queue.enqueue(owner, 's', definition, {}, 1);
    s.queue.claim(owner, r.id, 'new');
    expect(s.queue.status(owner, r.id, 'old', 'approved', 'bad', 2)).toBe(false);
    expect(s.queue.status({ ...owner, agentId: 'b' }, r.id, 'new', 'approved', 'bad', 2)).toBe(
      false,
    );
    expect(s.queue.status(owner, r.id, 'new', 'pending', 'pending', 2)).toBe(true);
    expect(s.queue.status(owner, r.id, 'new', 'approved', 'done', 3)).toBe(true);
    expect(s.queue.status(owner, r.id, 'new', 'denied', 'bad', 4)).toBe(true);
    expect(s.queue.get(owner, r.id)?.state).toBe('approved');
    s.close();
  });
});
