import { afterEach, describe, expect, it } from 'vitest';
import { createInvite } from '../../src/link/invites.js';
import { RevocationSweep, REVOCATION_SWEEP_MS } from '../../src/link/revocation.js';
import { ORIGIN, TestClient, hello, startServer, type Harness } from './helpers.js';

let h: Harness | undefined;
let sweep: RevocationSweep | undefined;
const clients: TestClient[] = [];
afterEach(async () => {
  sweep?.stop();
  sweep = undefined;
  clients.splice(0).forEach((c) => c.ws.terminate());
  await h?.server.close();
  h?.store.close();
  h = undefined;
});

async function boot(intervalMs = 3_600_000): Promise<Harness> {
  h = await startServer({ serverMode: true });
  const server = h.server;
  sweep = new RevocationSweep({
    registry: h.registry,
    store: () => h?.store,
    drop: (c) => server.dropConnection(c),
    intervalMs,
  });
  return h;
}
async function pair(userId = 'u1'): Promise<{ tc: TestClient; token: string }> {
  const { code } = createInvite(h!.store, { worldId: 'w1', userId }, Date.now());
  const tc = await TestClient.connect(h!.port, ORIGIN);
  clients.push(tc);
  tc.send(hello({ kind: 'pairingCode', code }, { userId }));
  const w = await tc.next();
  if (w.type !== 'welcome' || !w.pairingToken) throw new Error(`not paired: ${JSON.stringify(w)}`);
  return { tc, token: w.pairingToken };
}
const seedGrant = (id: string, userId = 'u1') => {
  const oauth = h!.store.oauth;
  if (!oauth.getClient('c'))
    oauth.createClient({
      id: 'c',
      secretHash: null,
      name: 'n',
      redirectUris: ['https://c.example/cb'],
      createdAt: 1,
    });
  oauth.createGrant({ id, clientId: 'c', worldId: 'w1', userId, scopes: ['read'], createdAt: 1 });
  oauth.insertToken({
    tokenHash: `t-${id}`,
    kind: 'access',
    grantId: id,
    familyId: id,
    audience: 'a',
    expiresAt: Date.now() + 60_000,
  });
};

describe('revocation sweep', () => {
  it('has a 5 s default', () => expect(REVOCATION_SWEEP_MS).toBe(5000));

  it('closes a revoked live connection with PAIRING_INVALID and 1008, and its token cannot reconnect', async () => {
    await boot(50);
    sweep!.start();
    const a = await pair();
    seedGrant('g1');
    h!.store.revokePairingsFor('w1', 'u1');
    expect(await a.tc.next()).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
    await a.tc.untilClosed();
    expect(h!.registry.get('w1', 'u1')).toBeUndefined();
    expect(h!.store.oauth.getGrant('g1')?.revokedAt).not.toBeNull();
    const again = await TestClient.connect(h!.port, ORIGIN);
    clients.push(again);
    again.send(hello({ kind: 'pairingToken', token: a.token }));
    expect(await again.next()).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
  });

  it('leaves active pairings alone', async () => {
    await boot();
    const a = await pair();
    expect(sweep!.sweepOnce()).toBe(0);
    expect(a.tc.closed).toBe(false);
  });

  it('never touches grants: a grant made after the revoke survives the sweep', async () => {
    await boot();
    const a = await pair();
    seedGrant('g-old');
    h!.store.revokePairingsFor('w1', 'u1');
    // A grant for the same (world, user) made after the revoke and before the sweep.
    seedGrant('g-new');
    expect(h!.store.oauth.getGrant('g-new')?.revokedAt).toBeNull();
    expect(sweep!.sweepOnce()).toBe(1);
    await a.tc.untilClosed();
    expect(h!.store.oauth.getGrant('g-new')?.revokedAt).toBeNull();
    expect(h!.store.oauth.getToken('t-g-new')?.revokedAt).toBeNull();
  });

  it('revoke, re-pair and a new grant before the sweep: the new grant and token stay live', async () => {
    await boot();
    const old = await pair();
    seedGrant('g-old');
    h!.store.revokePairingsFor('w1', 'u1');
    const fresh = await pair();
    seedGrant('g-new');
    sweep!.sweepOnce();
    await old.tc.untilClosed();
    expect(fresh.tc.closed).toBe(false);
    expect(h!.store.oauth.getGrant('g-new')?.revokedAt).toBeNull();
    expect(h!.store.oauth.getToken('t-g-new')?.revokedAt).toBeNull();
  });

  it('fires the in-memory listeners once per closed connection, isolated', async () => {
    await boot();
    const a = await pair();
    const seen: string[] = [];
    h!.store.onPairingRevoked(() => {
      throw new Error('first listener fails');
    });
    h!.store.onPairingRevoked((p) => void seen.push(p.userId));
    h!.store.revokePairingsFor('w1', 'u1');
    seen.length = 0;
    expect(sweep!.sweepOnce()).toBe(1);
    expect(seen).toEqual(['u1']);
    expect(sweep!.sweepOnce()).toBe(0);
    await a.tc.untilClosed();
  });
});

describe('invites after revoke and cancel', () => {
  const tryRedeem = async (code: string, userId = 'u1') => {
    const tc = await TestClient.connect(h!.port, ORIGIN);
    clients.push(tc);
    tc.send(hello({ kind: 'pairingCode', code }, { userId }));
    return tc.next();
  };

  it('an unused invite issued before a revoke is refused afterwards and shows cancelled', async () => {
    await boot();
    const { code } = createInvite(h!.store, { worldId: 'w1', userId: 'u1' }, Date.now());
    h!.store.revokePairingsFor('w1', 'u1');
    expect(await tryRedeem(code)).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
    expect(h!.store.invites.list()[0]).toMatchObject({ result: 'cancelled' });
    expect(h!.store.listPairings()).toEqual([]);
  });

  it('a cancelled invite is refused, the pairing stays, and another target still pairs', async () => {
    await boot();
    await pair('u1');
    const target = createInvite(h!.store, { worldId: 'w1', userId: 'u1' }, Date.now());
    const other = createInvite(h!.store, { worldId: 'w1', userId: 'u2' }, Date.now());
    expect(h!.store.transaction(() => h!.store.invites.cancelFor('w1', 'u1'))).toBe(1);
    expect(await tryRedeem(target.code)).toMatchObject({ code: 'PAIRING_INVALID' });
    expect(h!.store.listActivePairings().map((p) => p.userId)).toEqual(['u1']);
    expect(await tryRedeem(other.code, 'u2')).toMatchObject({ type: 'welcome' });
  });
});
