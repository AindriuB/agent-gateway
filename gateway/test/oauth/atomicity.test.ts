import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { EventBuffer } from '../../src/events/buffer.js';
import { OfflineQueue } from '../../src/offline-queue/service.js';
import { createOAuthRepository, type OAuthRepository } from '../../src/oauth/repository.js';
import { applyMigrations } from '../../src/store/migrate.js';
import { MIGRATIONS } from '../../src/store/migrations/index.js';
import { startServer, type Harness } from '../link/helpers.js';
import { pairModule, until, type FakeModule } from '../routing/harness.js';

let db: DatabaseSync | undefined;
let h: Harness | undefined;
let mod: FakeModule | undefined;
afterEach(async () => {
  db?.close();
  db = undefined;
  mod?.tc.ws.terminate();
  mod = undefined;
  await h?.server.close();
  h?.store.close();
  h = undefined;
});

function seeded(): OAuthRepository {
  db = new DatabaseSync(':memory:');
  applyMigrations(db, MIGRATIONS);
  const repo = createOAuthRepository(db);
  repo.createClient({
    id: 'c',
    secretHash: null,
    name: 'n',
    redirectUris: ['https://c.example/cb'],
    createdAt: 1,
  });
  for (const [id, user] of [
    ['g1', 'u1'],
    ['g2', 'u2'],
  ] as const) {
    repo.createGrant({
      id,
      clientId: 'c',
      worldId: 'w1',
      userId: user,
      scopes: ['read'],
      createdAt: 1,
    });
    repo.insertToken({
      tokenHash: `t-${id}`,
      kind: 'access',
      grantId: id,
      familyId: id,
      audience: 'a',
      expiresAt: 9,
    });
  }
  return repo;
}

describe('revokeGrantsFor transactions', () => {
  it('works outside a transaction', () => {
    const repo = seeded();
    expect(repo.revokeGrantsFor('w1', 'u1', 5)).toBe(1);
    expect(repo.getGrant('g1')?.revokedAt).toBe(5);
    expect(repo.getToken('t-g1')?.revokedAt).toBe(5);
    expect(repo.getGrant('g2')?.revokedAt).toBeNull();
  });

  it('works inside an open BEGIN IMMEDIATE, and an outer rollback undoes it', () => {
    const repo = seeded();
    db!.exec('BEGIN IMMEDIATE');
    expect(repo.revokeGrantsFor('w1', 'u1', 5)).toBe(1);
    expect(repo.getGrant('g1')?.revokedAt).toBe(5);
    db!.exec('ROLLBACK');
    expect(repo.getGrant('g1')?.revokedAt).toBeNull();
    expect(repo.getToken('t-g1')?.revokedAt).toBeNull();
    db!.exec('BEGIN IMMEDIATE');
    repo.revokeGrantsFor('w1', 'u1', 6);
    db!.exec('COMMIT');
    expect(repo.getGrant('g1')?.revokedAt).toBe(6);
  });

  it('leaves the outer transaction usable after a failure inside', () => {
    const repo = seeded();
    db!.exec('BEGIN IMMEDIATE');
    db!.exec('DROP TABLE oauth_tokens');
    expect(() => repo.revokeGrantsFor('w1', 'u1', 5)).toThrow();
    db!.exec('ROLLBACK');
    expect(repo.getToken('t-g1')?.revokedAt).toBeNull();
    expect(repo.getGrant('g1')?.revokedAt).toBeNull();
  });
});

describe('pairing revocation listeners', () => {
  it('runs the oauth, events and queue effects for one revokePairing', async () => {
    h = await startServer();
    const events = new EventBuffer(h.store, h.registry);
    const queue = new OfflineQueue(h.store, h.registry);
    let changed = 0;
    events.on('changed', () => changed++);
    mod = await pairModule(h, 'u1');
    h.store.oauth.createClient({
      id: 'c',
      secretHash: null,
      name: 'n',
      redirectUris: ['https://c.example/cb'],
      createdAt: 1,
    });
    h.store.oauth.createGrant({
      id: 'g1',
      clientId: 'c',
      worldId: 'w1',
      userId: 'u1',
      scopes: ['read'],
      createdAt: 1,
    });
    await until(() => h!.registry.list().length === 1);
    changed = 0;
    const id = h.store.listActivePairings()[0]!.id;
    expect(h.store.revokePairing(id)).toBe(true);
    expect(h.store.oauth.getGrant('g1')?.revokedAt).not.toBeNull();
    expect(changed).toBeGreaterThan(0);
    expect(h.registry.get('w1', 'u1')).toBeUndefined();
    await mod.tc.untilClosed();
    events.close();
    queue.close();
  });
});
