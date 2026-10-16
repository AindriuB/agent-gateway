import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openStore } from '../../src/store/index.js';
import { applyMigrations } from '../../src/store/migrate.js';
import { MIGRATIONS } from '../../src/store/migrations/index.js';

const hashToken = (t: string): string => createHash('sha256').update(t).digest('hex');

/** Type-checks `code` against the real sources with tsc; returns tsc's diagnostics ('' if clean). */
function typeCheck(code: string): string {
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const d = mkdtempSync(join(tmpdir(), 'ag-types-'));
  try {
    writeFileSync(join(d, 'package.json'), '{"type":"module"}');
    writeFileSync(join(d, 'check.ts'), code.replaceAll('SRC', join(root, 'gateway/src')));
    writeFileSync(
      join(d, 'tsconfig.json'),
      JSON.stringify({
        extends: join(root, 'tsconfig.base.json'),
        compilerOptions: {
          noEmit: true,
          typeRoots: [join(root, 'node_modules/@types')],
          types: ['node'],
        },
        files: ['check.ts'],
      }),
    );
    const r = spawnSync(join(root, 'node_modules/.bin/tsc'), ['-p', d], { encoding: 'utf8' });
    return r.stdout + r.stderr;
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

const dir = (): string => mkdtempSync(join(tmpdir(), 'ag-store-'));

describe('openStore failure', () => {
  it('closes the database handle when setup throws', () => {
    const path = join(dir(), 'bad.db');
    writeFileSync(path, 'not a sqlite database'.repeat(100));
    const close = vi.spyOn(DatabaseSync.prototype, 'close');
    expect(() => openStore(path)).toThrow();
    expect(close).toHaveBeenCalledTimes(1);
    close.mockRestore();
  });
});

describe('store', () => {
  it('creates, finds and revokes pairings', () => {
    const s = openStore(':memory:', () => 42);
    const row = s.createPairing({
      id: 'a1',
      tokenHash: 'h',
      worldId: 'w',
      userId: 'u',
      origin: 'https://foundry.local',
    });
    expect(row).toEqual({
      id: 'a1',
      tokenHash: 'h',
      worldId: 'w',
      userId: 'u',
      userName: '',
      createdAt: 42,
      revokedAt: null,
      origin: 'https://foundry.local',
      admin: false,
    });
    expect(s.findPairingByHash('h')?.id).toBe('a1');
    expect(s.findPairingByHash('x')).toBeUndefined();
    expect(s.revokePairing('a1')).toBe(true);
    expect(s.findPairingByHash('h')?.revokedAt).toBe(42);
    expect(s.revokePairing('a1')).toBe(false);
  });

  it('records the user name at pairing and lists only active pairings', () => {
    const s = openStore(':memory:');
    s.createPairing({ id: 'a1', tokenHash: 'h1', worldId: 'w', userId: 'u1', userName: 'alice' });
    s.createPairing({ id: 'a2', tokenHash: 'h2', worldId: 'w', userId: 'u2', userName: 'bob' });
    s.revokePairing('a2');
    expect(s.findPairingByHash('h1')?.userName).toBe('alice');
    expect(s.listActivePairings().map((p) => p.id)).toEqual(['a1']);
  });

  it('migrates a file store once and reopens it', () => {
    const path = join(dir(), 'g.db');
    const s = openStore(path);
    s.createPairing({ id: 'a1', tokenHash: 'h', worldId: 'w', userId: 'u' });
    s.close();
    const again = openStore(path);
    expect(again.findPairingByHash('h')?.id).toBe('a1');
    again.close();
  });

  it('persists a hash it is given and does not invent other copies of it', () => {
    const d = dir();
    const s = openStore(join(d, 'g.db'));
    // The store API only accepts hashes; the raw-token-absent end-to-end check is in server.test.ts.
    const token = 'RAW-TOKEN-never-passed-to-store';
    s.createPairing({ id: 'a1', tokenHash: hashToken(token), worldId: 'w', userId: 'u' });
    s.close();
    const files = readdirSync(d);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(readFileSync(join(d, f)).includes(token)).toBe(false);
    }
    const again = openStore(join(d, 'g.db'));
    expect(again.findPairingByHash(hashToken(token))?.id).toBe('a1');
    again.close();
  });

  it('applies migrations in order and records user_version', () => {
    const m = MIGRATIONS;
    expect(m.length).toBeGreaterThanOrEqual(1);
    expect(m[0]).toContain('CREATE TABLE pairings');
    const db = new DatabaseSync(':memory:');
    applyMigrations(db, ['CREATE TABLE a (x)', 'CREATE TABLE b (x)']);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    applyMigrations(db, ['CREATE TABLE a (x)', 'CREATE TABLE b (x)', 'CREATE TABLE c (x)']);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 });
    db.close();
  });

  it('registry order matches NNN- filename order of the migration files', async () => {
    const files = readdirSync(new URL('../../src/store/migrations/', import.meta.url))
      .filter((f) => /^\d{3}-.*\.ts$/.test(f))
      .sort();
    expect(files.length).toBe(MIGRATIONS.length);
    for (const [i, f] of files.entries()) {
      expect(Number(f.slice(0, 3))).toBe(i + 1);
      const mod = (await import(
        /* @vite-ignore */ `../../src/store/migrations/${f.replace(/\.ts$/, '.js')}`
      )) as {
        default: string;
      };
      expect(MIGRATIONS[i]).toBe(mod.default);
    }
  });

  it('has at least fourteen migrations', () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(14);
  });

  it('migrates a version 6 database with one pairing: origin reads back null, and 008 revokes it', () => {
    const d = dir();
    const path = join(d, 'g.db');
    const old = new DatabaseSync(path);
    applyMigrations(old, MIGRATIONS.slice(0, 6));
    expect(old.prepare('PRAGMA user_version').get()).toEqual({ user_version: 6 });
    old
      .prepare(
        'INSERT INTO pairings (id, token_hash, world_id, user_id, user_name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('old', 'hash-old', 'w', 'u', 'alice', 5);
    old.close();
    const s = openStore(path);
    expect(s.findPairingByHash('hash-old')).toMatchObject({
      id: 'old',
      origin: null,
      revokedAt: expect.any(Number),
    });
    expect(s.listActivePairings()).toEqual([]);
    s.close();
    const check = new DatabaseSync(path);
    expect(check.prepare('PRAGMA user_version').get()).toEqual({ user_version: MIGRATIONS.length });
    check.close();
  });

  it('createPairing without an origin fails tsc, and with one passes', () => {
    const body = (extra: string) => `import type { NewPairing } from 'SRC/store/store.js';
export const p: NewPairing = { id: 'a', tokenHash: 'h', worldId: 'w', userId: 'u'${extra} };
`;
    expect(typeCheck(body(", origin: 'https://foundry.local'"))).toBe('');
    expect(typeCheck(body(''))).toMatch(/origin/);
  }, 30_000);
});
