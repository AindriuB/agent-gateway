import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SWEEP_BATCH, SWEEP_INTERVAL_MS } from '../../../src/oauth/index.js';
import { call } from '../helpers.js';
import { consentRig, stopRig, type ConsentRig } from '../consent/rig.js';

let r: ConsentRig | undefined;
afterEach(async () => {
  await stopRig(r);
  r = undefined;
});

const counts = (r: ConsentRig) => {
  const db = new DatabaseSync(r.h.dbPath, { readOnly: true });
  const n = (t: string): number =>
    (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
  const out = { codes: n('oauth_codes'), tokens: n('oauth_tokens'), grants: n('oauth_grants') };
  db.close();
  return out;
};

function seed(r: ConsentRig, id: string, opts: { revoked: boolean; expires: number }): void {
  const repo = r.h.store.oauth;
  repo.createClient({
    id: `c-${id}`,
    secretHash: null,
    name: 'C',
    redirectUris: ['https://x/cb'],
    createdAt: 1,
  });
  repo.createGrant({
    id,
    clientId: `c-${id}`,
    worldId: 'w1',
    userId: 'u1',
    scopes: ['read'],
    createdAt: 1,
  });
  repo.insertCode({
    codeHash: `code-${id}`,
    grantId: id,
    redirectUri: 'https://x/cb',
    codeChallenge: 'c',
    resource: 'r',
    expiresAt: opts.expires,
  });
  for (const kind of ['access', 'refresh'] as const)
    repo.insertToken({
      tokenHash: `${kind}-${id}`,
      kind,
      grantId: id,
      familyId: id,
      audience: 'r',
      expiresAt: opts.expires,
    });
  if (opts.revoked) repo.revokeGrant(id, 2);
}

describe('retention sweep', () => {
  it('deletes expired codes and tokens, then revoked grants left with nothing', async () => {
    r = await consentRig();
    const repo = r.h.store.oauth;
    seed(r, 'dead', { revoked: true, expires: 100 });
    seed(r, 'live', { revoked: false, expires: 10_000_000 });
    seed(r, 'revokedLive', { revoked: true, expires: 10_000_000 });
    expect(counts(r)).toEqual({ codes: 3, tokens: 6, grants: 3 });
    expect(repo.sweep(1_000, SWEEP_BATCH)).toBe(1 + 2 + 1);
    // 'dead' is gone entirely; a revoked grant whose tokens have not yet passed their TTL stays.
    expect(counts(r)).toEqual({ codes: 2, tokens: 4, grants: 2 });
    expect(repo.getGrant('live')).toBeDefined();
    expect(repo.getGrant('dead')).toBeUndefined();
    // An expired but unrevoked grant's tokens go too, the live grant itself stays.
    expect(repo.sweep(20_000_000, SWEEP_BATCH)).toBeGreaterThan(0);
    expect(counts(r)).toEqual({ codes: 0, tokens: 0, grants: 1 });
    expect(repo.getGrant('live')).toBeDefined();
  });

  it('never deletes more than the batch per table in one run', async () => {
    r = await consentRig();
    const repo = r.h.store.oauth;
    for (let i = 0; i < 5; i++) seed(r, `g${i}`, { revoked: true, expires: 100 });
    // 2 codes, 2 tokens (all of g0's), then g0 itself, which now has nothing left.
    expect(repo.sweep(1_000, 2)).toBe(2 + 2 + 1);
    expect(counts(r)).toEqual({ codes: 3, tokens: 8, grants: 4 });
    let total = 0;
    for (let i = 0; i < 10; i++) total += repo.sweep(1_000, 2);
    expect(counts(r)).toEqual({ codes: 0, tokens: 0, grants: 0 });
    expect(total).toBe(3 + 8 + 4);
  });

  it('runs lazily from requests, at most once per interval', async () => {
    r = await consentRig();
    seed(r, 'old', { revoked: true, expires: 100 });
    r.clock.t = 10_000_000;
    await call(r.port, 'POST', '/register', {
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(counts(r)).toEqual({ codes: 0, tokens: 0, grants: 0 });
    seed(r, 'old2', { revoked: true, expires: 100 });
    await call(r.port, 'POST', '/register', {
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(counts(r).grants).toBe(1);
    r.clock.t += SWEEP_INTERVAL_MS;
    await call(r.port, 'POST', '/register', {
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(counts(r).grants).toBe(0);
  });
});
