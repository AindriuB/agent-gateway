import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { openStore } from '../../src/store/index.js';
import { createEventRepository } from '../../src/events/repository.js';
import { applyMigrations } from '../../src/store/migrate.js';
import { MIGRATIONS } from '../../src/store/migrations/index.js';
const owner = { worldId: 'w', userId: 'u', agentId: 'a' };
const event = (seq = 1, userId = 'u') => ({
  seq,
  ts: 1,
  type: 'actor_update' as const,
  userId,
  summary: 'Actor updated',
});
describe('transactional event repository', () => {
  it('isolates world, user and pairing while sharing monotonic pair cursors', () => {
    const s = openStore(':memory:');
    try {
      s.events.append(owner, event(), 10);
      s.events.append({ ...owner, agentId: 'new' }, event(), 20);
      s.events.append({ ...owner, worldId: 'other' }, event(), 30);
      s.events.append({ ...owner, userId: 'other' }, event(1, 'other'), 40);
      expect(s.events.read(owner, undefined, 100).events.map((e) => e.cursor)).toEqual([1]);
      expect(
        s.events.read({ ...owner, agentId: 'new' }, undefined, 100).events.map((e) => e.cursor),
      ).toEqual([2]);
      expect(
        s.events.read({ ...owner, worldId: 'other' }, undefined, 100).events.map((e) => e.cursor),
      ).toEqual([1]);
      expect(() => s.events.read(owner, 999, 100)).toThrow('future');
    } finally {
      s.close();
    }
  });
  it('retains exactly10000 oldest-first, reports eviction and persists cursors on reopen', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'task28-')), 'events.db');
    let s = openStore(path);
    for (let i = 1; i <= 10001; i++) s.events.append(owner, event(i), i);
    const first = s.events.read(owner, 0, 100);
    expect(first.events[0]?.cursor).toBe(2);
    expect(first.cursorGap).toEqual({ after: 0, firstAvailable: 2 });
    s.close();
    s = openStore(path);
    expect(s.events.append(owner, event(10002), 10002).cursor).toBe(10002);
    expect(s.events.read(owner, 9902, 100).events).toHaveLength(100);
    const raw = new DatabaseSync(path);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM event_rows').get()?.n).toBe(10000);
    raw.close();
    s.close();
  }, 15000);
  it('reports a wholly evicted old pairing without returning another pairing payload', () => {
    const s = openStore(':memory:');
    s.events.append(owner, event(), 1);
    for (let i = 0; i < 10000; i++)
      s.events.append({ ...owner, agentId: 'replacement' }, event(i + 1), i + 2);
    expect(s.events.read(owner, 0, 100)).toEqual({
      events: [],
      nextAfter: 1,
      cursorGap: { after: 0, firstAvailable: 2 },
    });
    const acknowledged = s.events.read(owner, 0, 100).nextAfter;
    expect(s.events.read(owner, acknowledged, 100)).toEqual({ events: [], nextAfter: 1 });
    s.close();
  });
  it('uses receipt time, filters type and never consumes independent reads', () => {
    const s = openStore(':memory:');
    s.events.append(owner, { ...event(), ts: 999999 }, 10);
    s.events.append(owner, { ...event(2), ts: 0, type: 'actor_create' }, 20);
    const r = s.events.history(owner, 15, ['actor_create'], 100);
    expect(r.events.map((e) => e.cursor)).toEqual([2]);
    expect(s.events.read(owner, undefined, 1)).toEqual(s.events.read(owner, undefined, 1));
    expect(s.events.read(owner, 2, 100)).toEqual({ events: [], nextAfter: 2 });
    s.close();
  });
  it('rolls back inserted payload, eviction and cursor advancement on storage failure', () => {
    const db = new DatabaseSync(':memory:');
    applyMigrations(db, MIGRATIONS);
    const r = createEventRepository(db);
    r.append(owner, event(), 1);
    db.exec(
      "CREATE TRIGGER fail_cursor BEFORE UPDATE ON event_streams BEGIN SELECT RAISE(ABORT,'injected'); END",
    );
    expect(() => r.append(owner, event(2), 2)).toThrow('injected');
    expect(r.read(owner, 0, 100).events.map((e) => e.cursor)).toEqual([1]);
    db.exec('DROP TRIGGER fail_cursor');
    expect(r.append(owner, event(2), 2).cursor).toBe(2);
    db.exec(
      "CREATE TRIGGER fail_evict BEFORE DELETE ON event_rows BEGIN SELECT RAISE(ABORT,'evict failure'); END",
    );
    db.prepare('UPDATE event_streams SET next_cursor=10001').run();
    expect(() => r.append(owner, event(3), 3)).toThrow('evict failure');
    expect(db.prepare('SELECT COUNT(*) AS n FROM event_evictions').get()?.n).toBe(0);
    expect(db.prepare('SELECT next_cursor FROM event_streams').get()?.next_cursor).toBe(10001);
    expect(r.read(owner, 0, 100).events.map((e) => e.cursor)).toEqual([1, 2]);
    db.close();
  });
});
