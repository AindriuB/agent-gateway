import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { LinkRegistry } from '../../src/link/index.js';
import { SessionBinding } from '../../src/routing/index.js';
import { applyMigrations } from '../../src/store/migrate.js';
import { MIGRATIONS } from '../../src/store/migrations/index.js';
import { openStore } from '../../src/store/index.js';

describe('migration 008: retire legacy pairings', () => {
  it('revokes the NULL-origin active row only, keeps it, and leaves binding on the other', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ag-008-')), 'g.db');
    const old = new DatabaseSync(path);
    applyMigrations(old, MIGRATIONS.slice(0, 7));
    expect(old.prepare('PRAGMA user_version').get()).toEqual({ user_version: 7 });
    const insert = old.prepare(
      'INSERT INTO pairings (id, token_hash, world_id, user_id, user_name, created_at, origin, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run('legacy', 'h1', 'w1', 'uOld', 'old', 5, null, null);
    insert.run('current', 'h2', 'w1', 'uNew', 'new', 6, 'http://localhost:30000', null);
    insert.run('already', 'h3', 'w1', 'uGone', 'gone', 7, null, 1234);
    old.close();

    const before = Date.now();
    const s = openStore(path);
    expect(s.findPairingByHash('h1')).toMatchObject({ id: 'legacy', origin: null });
    expect(s.findPairingByHash('h1')!.revokedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(s.findPairingByHash('h1')!.revokedAt).toBeLessThanOrEqual(Date.now());
    expect(s.findPairingByHash('h2')).toMatchObject({ id: 'current', revokedAt: null });
    expect(s.findPairingByHash('h3')).toMatchObject({ revokedAt: 1234 });
    expect(s.listActivePairings().map((p) => p.id)).toEqual(['current']);

    const binding = new SessionBinding(new LinkRegistry(), {}, () =>
      s
        .listActivePairings()
        .map((p) => ({ worldId: p.worldId, userId: p.userId, userName: p.userName })),
    );
    expect(binding.resolve()).toMatchObject({
      kind: 'bound',
      pair: { worldId: 'w1', userId: 'uNew' },
    });
    s.close();

    const check = new DatabaseSync(path);
    expect(check.prepare('PRAGMA user_version').get()).toEqual({ user_version: 8 });
    expect(check.prepare('SELECT count(*) AS n FROM pairings').get()).toEqual({ n: 3 });
    check.close();
  });
});
