import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openStore } from '../../src/store/index.js';
import { applyMigrations } from '../../src/store/migrate.js';
import { MIGRATIONS } from '../../src/store/migrations/index.js';

const hashToken = (t: string): string => createHash('sha256').update(t).digest('hex');

const dir = (): string => mkdtempSync(join(tmpdir(), 'ag-store-'));

describe('store', () => {
  it('creates, finds and revokes pairings', () => {
    const s = openStore(':memory:', () => 42);
    const row = s.createPairing({ id: 'a1', tokenHash: 'h', worldId: 'w', userId: 'u' });
    expect(row).toEqual({
      id: 'a1',
      tokenHash: 'h',
      worldId: 'w',
      userId: 'u',
      createdAt: 42,
      revokedAt: null,
    });
    expect(s.findPairingByHash('h')?.id).toBe('a1');
    expect(s.findPairingByHash('x')).toBeUndefined();
    expect(s.revokePairing('a1')).toBe(true);
    expect(s.findPairingByHash('h')?.revokedAt).toBe(42);
    expect(s.revokePairing('a1')).toBe(false);
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
      const mod = (await import(/* @vite-ignore */ `../../src/store/migrations/${f.replace(/\.ts$/, '.js')}`)) as {
        default: string;
      };
      expect(MIGRATIONS[i]).toBe(mod.default);
    }
  });
});
