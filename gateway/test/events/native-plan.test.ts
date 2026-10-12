import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  task28Plan,
  task28Pins,
  assertTask28Read,
  task28ReadPairings,
  task28Track,
  task28Drain,
} from './native-plan.js';
import { task28NativeState } from './native-state.js';
describe('bounded Task28 native plan and actual callback serialization', () => {
  it('uses exactly one private NPC, two names and validated source/build pins', () => {
    const plan = task28Plan('0123456789ab', 'gm');
    expect(plan.fixtureCount).toBe(1);
    expect(plan.actor.ownership).toEqual({ default: 0, gm: 3 });
    expect(plan.names).toHaveLength(2);
    expect(() => task28Plan('bad', 'gm')).toThrow();
    expect(() => task28Pins('bad', 'a'.repeat(64))).toThrow();
    expect(() => task28Pins('a'.repeat(40), 'bad')).toThrow();
  });
  it('rejects observer/payload leaks and invalid cursor continuation', () => {
    const row = {
      cursor: 1,
      event: {
        seq: 1,
        ts: 1,
        type: 'actor_update',
        userId: 'gm',
        summary: 'Actor updated',
        doc: { uuid: 'Actor.private', type: 'Actor', name: 'Private' },
      },
    };
    expect(assertTask28Read({ events: [row], nextAfter: 1 }, 'gm').events).toHaveLength(1);
    expect(() => assertTask28Read({ events: [row], nextAfter: 1 }, 'player')).toThrow();
    expect(() =>
      assertTask28Read({ events: [row], nextAfter: 1 }, 'gm', ['Actor.private']),
    ).toThrow();
    expect(() => assertTask28Read({ events: [row, row], nextAfter: 1 }, 'gm')).toThrow();
    expect(() => assertTask28Read({ events: [row], nextAfter: 0 }, 'gm')).toThrow();
  });
  it('runs the actually imported tsx callback in an isolated VM without injected naming helpers', async () => {
    const call = runInNewContext(`(${task28NativeState.toString()})`, {});
    await expect(call({ op: 'baseline', generation: 14 })).rejects.toThrow(
      'Exact sole canonical native GM',
    );
  });
});

describe('native isolation and terminal poll cleanup', () => {
  it('imports only exact active pairings without changing existing database bytes or schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'task28-readonly-'));
    const path = join(dir, 'existing.db');
    try {
      const db = new DatabaseSync(path);
      db.exec(`CREATE TABLE pairings(id TEXT, token_hash TEXT, world_id TEXT, user_id TEXT, user_name TEXT, revoked_at INTEGER);
        PRAGMA user_version=2;
        INSERT INTO pairings VALUES ('a','hash','world','gm','GM',NULL),('b','other','other','gm','GM',NULL),('c','revoked','world','p','P',1)`);
      db.close();
      const before = readFileSync(path);
      expect(task28ReadPairings(path, 'world')).toEqual([
        { id: 'a', tokenHash: 'hash', worldId: 'world', userId: 'gm', userName: 'GM' },
      ]);
      expect(readFileSync(path)).toEqual(before);
      const check = new DatabaseSync(path, { readOnly: true });
      expect(check.prepare('PRAGMA user_version').get()?.user_version).toBe(2);
      expect(
        check.prepare("SELECT name FROM sqlite_master WHERE name='event_rows'").get(),
      ).toBeUndefined();
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('observes immediate rejection and drains other sessions despite a rejecting close before cleanup', async () => {
    const pending = new Set<Promise<unknown>>();
    const failed = task28Track(pending, Promise.reject(Error('early poll failure')));
    let settle!: () => void;
    task28Track(
      pending,
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    let cleaned = false;
    await task28Drain(
      [
        {
          close: async () => {
            throw Error('close failed');
          },
        },
        {
          close: async () => {
            settle();
          },
        },
      ],
      pending,
    );
    cleaned = true;
    await expect(failed).rejects.toThrow('early poll failure');
    expect(cleaned).toBe(true);
    expect(pending.size).toBe(0);
  });
  it('refuses cleanup when a started poll cannot settle', async () => {
    const pending = new Set<Promise<unknown>>();
    task28Track(pending, new Promise(() => {}));
    await expect(task28Drain([], pending, 5)).rejects.toThrow('did not settle');
  });
});
