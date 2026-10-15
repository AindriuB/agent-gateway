import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../../src/store/migrate.js';
import { MIGRATIONS } from '../../src/store/migrations/index.js';
import { openStore, type Store } from '../../src/store/index.js';

let store: Store | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

const pairing = (id: string, admin?: boolean) => ({
  id,
  tokenHash: `t-${id}`,
  worldId: 'w1',
  userId: `u-${id}`,
  origin: 'http://localhost:30000',
  ...(admin === undefined ? {} : { admin }),
});
const invite = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  codeHash: `h-${id}`,
  worldId: 'w1',
  userId: 'u1',
  origin: null,
  expiresAt: 9_000,
  ...extra,
});

describe('migration 012: admin flags', () => {
  it('adds the columns with 0/NULL defaults and keeps every row', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ag-012-')), 'g.db');
    const old = new DatabaseSync(path);
    applyMigrations(old, MIGRATIONS.slice(0, 11));
    expect(old.prepare('PRAGMA user_version').get()).toEqual({ user_version: 11 });
    old
      .prepare(
        'INSERT INTO pairings (id, token_hash, world_id, user_id, user_name, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('p1', 'h1', 'w1', 'u1', 'one', 5, 'http://localhost:30000');
    old
      .prepare(
        'INSERT INTO pairings (id, token_hash, world_id, user_id, user_name, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('p2', 'h2', 'w1', 'u2', 'two', 6, 'http://localhost:30000');
    for (const id of ['i1', 'i2'])
      old
        .prepare(
          'INSERT INTO invites (id, code_hash, world_id, user_id, origin, created_at, expires_at) VALUES (?, ?, ?, ?, NULL, 1, 9000)',
        )
        .run(id, `ih-${id}`, 'w1', `u-${id}`);
    old.close();

    const s = openStore(path);
    expect(s.listActivePairings().map((p) => [p.id, p.admin])).toEqual([
      ['p1', false],
      ['p2', false],
    ]);
    expect(s.invites.list().map((i) => [i.id, i.admin, i.gm, i.createdBy])).toEqual([
      ['i1', false, false, null],
      ['i2', false, false, null],
    ]);
    s.close();
    const check = new DatabaseSync(path);
    expect(check.prepare('PRAGMA user_version').get()).toEqual({ user_version: 13 });
    expect(MIGRATIONS).toHaveLength(13);
    check.close();
  });
});

describe('admin flag on pairings', () => {
  it('defaults to false, is set only at creation, and demotePairing clears it', () => {
    store = openStore(':memory:');
    expect(store.createPairing(pairing('a')).admin).toBe(false);
    expect(store.createPairing(pairing('b', true)).admin).toBe(true);
    expect(store.demotePairing('a')).toBe(false);
    expect(store.demotePairing('b')).toBe(true);
    expect(store.getPairing('b')?.admin).toBe(false);
    expect(store.demotePairing('b')).toBe(false);
    expect(store.demotePairing('missing')).toBe(false);
  });
});

describe('flags on invites', () => {
  it('defaults to false, false and null; stores the operator flags', () => {
    store = openStore(':memory:');
    expect(store.invites.create(invite('i1'))).toMatchObject({
      admin: false,
      gm: false,
      createdBy: null,
    });
    expect(store.invites.create(invite('i2', { admin: true, gm: true }))).toMatchObject({
      admin: true,
      gm: true,
      createdBy: null,
    });
    expect(store.invites.create(invite('i3', { createdBy: 'p1' }))).toMatchObject({
      admin: false,
      gm: false,
      createdBy: 'p1',
    });
  });

  it.each([{ admin: true }, { gm: true }])(
    'refuses %j on a delegated invite and writes nothing',
    (flags) => {
      store = openStore(':memory:');
      expect(() => store!.invites.create(invite('x', { createdBy: 'p1', ...flags }))).toThrow(
        /only the operator/,
      );
      expect(store.invites.list()).toEqual([]);
    },
  );
});
