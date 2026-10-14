import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openStore, type PairingRow, type Store } from '../../src/store/index.js';

let store: Store | undefined;
let dbPath = '';
const warns: string[] = [];
afterEach(() => {
  store?.close();
  store = undefined;
  warns.length = 0;
});

function open(): Store {
  dbPath = join(mkdtempSync(join(tmpdir(), 'ag-rl-')), 'g.db');
  store = openStore(dbPath, Date.now, (l) => void warns.push(l));
  const s = store;
  s.createPairing({ id: 'p1', tokenHash: 'h1', worldId: 'w1', userId: 'u1', origin: 'http://o' });
  s.oauth.createClient({
    id: 'c',
    secretHash: null,
    name: 'n',
    redirectUris: ['https://c.example/cb'],
    createdAt: 1,
  });
  s.oauth.createGrant({
    id: 'g1',
    clientId: 'c',
    worldId: 'w1',
    userId: 'u1',
    scopes: ['read'],
    createdAt: 1,
  });
  s.oauth.insertToken({
    tokenHash: 't1',
    kind: 'access',
    grantId: 'g1',
    familyId: 'g1',
    audience: 'a',
    expiresAt: Date.now() + 10_000,
  });
  return s;
}

function listeners(s: Store): { seen: string[][]; calls: () => number } {
  const seen: string[][] = [[], [], []];
  s.onPairingRevoked((p) => {
    seen[0]!.push(p.id);
    throw new Error('boom\x1b[31m\nsecond line');
  });
  s.onPairingRevoked((p) => void seen[1]!.push(p.id));
  s.onPairingRevoked((p) => void seen[2]!.push(p.id));
  return { seen, calls: () => seen.reduce((n, a) => n + a.length, 0) };
}

describe('revoke listeners are isolated, grants revoke in the transaction', () => {
  it('revokePairing runs every listener after the first throws, and commits', () => {
    const s = open();
    const { seen } = listeners(s);
    expect(s.revokePairing('p1')).toBe(true);
    expect(seen).toEqual([['p1'], ['p1'], ['p1']]);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('w1/u1');
    expect(warns[0]).toContain('boom');
    expect(warns[0]).not.toMatch(/[\x00-\x1f]/);
    expect(s.listActivePairings()).toEqual([]);
    expect(s.oauth.getGrant('g1')?.revokedAt).not.toBeNull();
    expect(s.oauth.getToken('t1')?.revokedAt).not.toBeNull();
  });

  it('revokePairingsFor behaves the same and also reports cancelled invites', () => {
    const s = open();
    s.invites.create({
      id: 'i1',
      codeHash: 'x',
      worldId: 'w1',
      userId: 'u1',
      origin: null,
      expiresAt: Date.now() + 1000,
    });
    const { seen } = listeners(s);
    const out = s.revokePairingsFor('w1', 'u1');
    expect(out.pairings.map((p) => p.id)).toEqual(['p1']);
    expect(out.cancelledInvites).toBe(1);
    expect(seen).toEqual([['p1'], ['p1'], ['p1']]);
    expect(warns).toHaveLength(1);
    expect(s.listActivePairings()).toEqual([]);
    expect(s.oauth.getGrant('g1')?.revokedAt).not.toBeNull();
    expect(s.invites.findByHash('x')).toMatchObject({ result: 'cancelled' });
  });

  it('notifyPairingRevoked isolates listeners and touches nothing', () => {
    const s = open();
    const { seen } = listeners(s);
    const row = s.listActivePairings()[0] as PairingRow;
    s.notifyPairingRevoked(row);
    expect(seen).toEqual([['p1'], ['p1'], ['p1']]);
    expect(warns).toHaveLength(1);
    expect(s.listActivePairings()).toHaveLength(1);
    expect(s.oauth.getGrant('g1')?.revokedAt).toBeNull();
  });

  it('a grant-revocation failure rolls the pairing revoke back', () => {
    const s = open();
    const { calls } = listeners(s);
    const raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA busy_timeout = 5000');
    raw.exec('DROP TABLE oauth_tokens');
    raw.close();
    expect(() => s.revokePairing('p1')).toThrow();
    expect(s.isPairingActive('p1', 'w1', 'u1')).toBe(true);
    expect(calls()).toBe(0);
    s.invites.create({
      id: 'i1',
      codeHash: 'x',
      worldId: 'w1',
      userId: 'u1',
      origin: null,
      expiresAt: Date.now() + 1000,
    });
    expect(() => s.revokePairingsFor('w1', 'u1')).toThrow();
    expect(s.isPairingActive('p1', 'w1', 'u1')).toBe(true);
    expect(s.invites.findByHash('x')).toMatchObject({ cancelledAt: null, result: null });
    expect(calls()).toBe(0);
  });

  it('registers no oauth listener: with none added, a revoke notifies nobody', () => {
    const s = open();
    expect(s.revokePairing('p1')).toBe(true);
    expect(warns).toEqual([]);
    expect(s.oauth.getGrant('g1')?.revokedAt).not.toBeNull();
  });

  it('transaction rolls back on error and rethrows the original', () => {
    const s = open();
    expect(() =>
      s.transaction(() => {
        s.invites.cancelFor('w1', 'u1');
        s.createPairing({
          id: 'p2',
          tokenHash: 'h2',
          worldId: 'w1',
          userId: 'u2',
          origin: 'http://o',
        });
        throw new Error('original');
      }),
    ).toThrow('original');
    expect(s.listActivePairings().map((p) => p.id)).toEqual(['p1']);
  });
});
