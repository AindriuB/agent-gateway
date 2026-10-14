import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openStore } from '../../src/store/index.js';
import { applyMigrations } from '../../src/store/migrate.js';
import { MIGRATIONS } from '../../src/store/migrations/index.js';

const cli = fileURLToPath(new URL('../../dist/bin/cli.js', import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmpDb = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'ag-wal-'));
  dirs.push(d);
  return join(d, 'g.db');
};
const pairing = (id: string) => ({
  id,
  tokenHash: `hash-${id}`,
  worldId: 'w1',
  userId: `u-${id}`,
  userName: id,
  origin: 'http://localhost:30000',
});
const mode = (path: string): string => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return (db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode;
  } finally {
    db.close();
  }
};

describe('WAL journal mode', () => {
  it('openStore leaves the database in WAL mode', () => {
    const path = tmpDb();
    const store = openStore(path);
    expect(mode(path)).toBe('wal');
    store.close();
    expect(mode(path)).toBe('wal');
  });

  it('a reader sees a committed pairing while a write transaction is open', () => {
    const path = tmpDb();
    const store = openStore(path);
    store.createPairing(pairing('a'));
    const writer = new DatabaseSync(path);
    writer.exec('PRAGMA busy_timeout = 5000');
    writer.exec('BEGIN IMMEDIATE');
    writer.exec("INSERT INTO gateway_settings (key, value) VALUES ('pending', 'x')");
    const reader = new DatabaseSync(path, { readOnly: true });
    try {
      reader.exec('PRAGMA busy_timeout = 0');
      const rows = reader.prepare('SELECT id FROM pairings').all() as { id: string }[];
      expect(rows.map((r) => r.id)).toEqual(['a']);
      const settings = reader.prepare('SELECT key FROM gateway_settings').all();
      expect(settings).toEqual([]);
    } finally {
      reader.close();
      writer.exec('ROLLBACK');
      writer.close();
      store.close();
    }
  });

  it('--http-rotate-token succeeds against a WAL db held by a running store, and takes effect at once', () => {
    const path = tmpDb();
    const store = openStore(path);
    store.setHttpTokenHash('0'.repeat(64));
    const r = spawnSync(process.execPath, [cli, '--http-rotate-token', '--db', path], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(r.status).toBe(0);
    const token = /: (\S+)\n/.exec(r.stderr)![1]!;
    expect(store.getHttpTokenHash()).toBe(createHash('sha256').update(token).digest('hex'));
    store.close();
  });

  it('the schema check works when no connection is open and no -wal or -shm file exists', () => {
    const path = tmpDb();
    openStore(path).close();
    expect(existsSync(`${path}-wal`)).toBe(false);
    expect(existsSync(`${path}-shm`)).toBe(false);
    const r = spawnSync(process.execPath, [cli, '--http-rotate-token', '--db', path], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(r.status).toBe(0);
  });

  it('opens a database file left in DELETE mode, with its rows intact', () => {
    const path = tmpDb();
    const old = new DatabaseSync(path);
    old.exec('PRAGMA journal_mode = DELETE');
    applyMigrations(old, MIGRATIONS);
    old
      .prepare(
        'INSERT INTO pairings (id, token_hash, world_id, user_id, user_name, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('p1', 'h1', 'w1', 'u1', 'one', 1, 'http://localhost:30000');
    old.close();
    expect(mode(path)).toBe('delete');
    const store = openStore(path);
    expect(mode(path)).toBe('wal');
    expect(store.listActivePairings().map((p) => p.id)).toEqual(['p1']);
    store.close();
  });

  it('does not warn about an in-memory database', () => {
    const warnings: string[] = [];
    const store = openStore(':memory:', Date.now, (l) => warnings.push(l));
    expect(warnings).toEqual([]);
    store.close();
  });
});
