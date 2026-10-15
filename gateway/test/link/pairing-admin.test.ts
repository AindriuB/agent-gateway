import { afterEach, describe, expect, it } from 'vitest';
import type { LinkMessage } from '@agent-gateway/protocol';
import {
  INVITE_MESSAGE_WINDOW_MS,
  MAX_INVITE_MESSAGES_PER_WINDOW,
} from '../../src/link/invite-admin.js';
import { createInvite } from '../../src/link/invites.js';
import { ORIGIN, TestClient, hello, startServer, type Harness } from './helpers.js';

let h: Harness | undefined;
const clients: TestClient[] = [];
let clock = 1_000_000;
const now = () => clock;

afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  await h?.server.close();
  h?.store.close();
  h = undefined;
});

async function boot(): Promise<Harness> {
  clock = 1_000_000;
  h = await startServer({ serverMode: true, now });
  return h;
}

async function pairWith(opts: {
  worldId: string;
  userId: string;
  admin?: boolean;
}): Promise<TestClient> {
  // A non-admin pairs through an operator GM invite, which skips the vouch.
  const { code } = createInvite(h!.store, { ...opts, gm: !opts.admin }, clock);
  const c = await TestClient.connect(h!.port, ORIGIN);
  clients.push(c);
  c.send(hello({ kind: 'pairingCode', code }, { worldId: opts.worldId, userId: opts.userId }));
  expect(await c.next()).toMatchObject({ type: 'welcome' });
  return c;
}
const admin = (worldId = 'w1', userId = 'gm1') => pairWith({ worldId, userId, admin: true });
const list = (c: TestClient, requestId = 'r1') => c.send({ type: 'listPairings', requestId });
const revoke = (c: TestClient, pairingId: string, requestId = 'r1') =>
  c.send({ type: 'revokePairing', requestId, pairingId });
const idOf = (world: string, user: string) =>
  h!.store.listActivePairings().find((p) => p.worldId === world && p.userId === user)!.id;
type Pairings = Extract<LinkMessage, { type: 'pairings' }>['pairings'];
const rows = (m: LinkMessage): Pairings =>
  (m as Extract<LinkMessage, { type: 'pairings' }>).pairings;

describe('who may manage pairings', () => {
  it('refuses a non-admin whose hello says isGM, changing nothing', async () => {
    await boot();
    await admin();
    const p = await pairWith({ worldId: 'w1', userId: 'p1' });
    list(p);
    revoke(p, idOf('w1', 'gm1'), 'r2');
    for (const id of ['r1', 'r2'])
      expect(await p.next('error')).toMatchObject({ code: 'FORBIDDEN', requestId: id });
    expect(h!.store.listActivePairings()).toHaveLength(2);
  });

  it('rejects a message carrying a world id', async () => {
    await boot();
    const gm = await admin();
    gm.send({ type: 'listPairings', requestId: 'r', worldId: 'w2' });
    await gm.untilClosed();
    expect(gm.closed).toBe(true);
  });

  it('refuses an admin demoted between two messages', async () => {
    await boot();
    const gm = await admin();
    list(gm);
    expect(await gm.next()).toMatchObject({ type: 'pairings' });
    h!.store.demotePairing(idOf('w1', 'gm1'));
    list(gm, 'r2');
    expect(await gm.next('error')).toMatchObject({ code: 'FORBIDDEN', requestId: 'r2' });
  });

  it('refuses an admin revoked a moment ago, before the sweep closes it', async () => {
    await boot();
    const gm = await admin();
    await pairWith({ worldId: 'w1', userId: 'p1' });
    const target = idOf('w1', 'p1');
    h!.store.revokePairingsFor('w1', 'gm1');
    revoke(gm, target, 'r2');
    expect(await gm.next('error')).toMatchObject({ code: 'FORBIDDEN', requestId: 'r2' });
    expect(h!.store.getPairing(target)!.revokedAt).toBeNull();
  });
});

describe('listPairings', () => {
  it('lists only this world, marks self and connected, and carries no token or hash', async () => {
    await boot();
    const gm = await admin();
    await pairWith({ worldId: 'w1', userId: 'p1' });
    await pairWith({ worldId: 'w2', userId: 'other' });
    list(gm);
    const reply = await gm.next('pairings');
    const got = rows(reply);
    expect(got.map((r) => r.userId).sort()).toEqual(['gm1', 'p1']);
    expect(got.find((r) => r.userId === 'gm1')).toMatchObject({ self: true, admin: true });
    expect(got.find((r) => r.userId === 'p1')).toMatchObject({ self: false, admin: false });
    expect(got.every((r) => r.connected)).toBe(true);
    const text = JSON.stringify(reply);
    for (const p of h!.store.listActivePairings()) expect(text).not.toContain(p.tokenHash);
    expect(text).not.toMatch(/token/i);
  });

  it('reports a pairing with no live connection as not connected', async () => {
    await boot();
    const gm = await admin();
    const p = await pairWith({ worldId: 'w1', userId: 'p1' });
    p.ws.terminate();
    await p.untilClosed();
    for (let i = 0; i < 50 && h!.registry.get('w1', 'p1'); i++)
      await new Promise((r) => setTimeout(r, 20));
    list(gm);
    expect(rows(await gm.next('pairings')).find((r) => r.userId === 'p1')?.connected).toBe(false);
  });
});

describe('revokePairing', () => {
  it('revokes a player with its grants and unused invites, and replies with the rest', async () => {
    await boot();
    const gm = await admin();
    await pairWith({ worldId: 'w1', userId: 'p1' });
    const id = idOf('w1', 'p1');
    const spare = createInvite(h!.store, { worldId: 'w1', userId: 'p1' }, clock);
    revoke(gm, id);
    const got = rows(await gm.next('pairings'));
    expect(got.map((r) => r.userId)).toEqual(['gm1']);
    expect(h!.store.getPairing(id)!.revokedAt).not.toBeNull();
    expect(h!.store.invites.getById(spare.id)!.cancelledAt).not.toBeNull();
  });

  it('refuses another admin in the same world with no change', async () => {
    await boot();
    const gm = await admin();
    await admin('w1', 'gm2');
    revoke(gm, idOf('w1', 'gm2'));
    expect(await gm.next('error')).toMatchObject({ code: 'FORBIDDEN', requestId: 'r1' });
    expect(h!.store.listActivePairings()).toHaveLength(2);
  });

  it('lets an admin revoke its own pairing', async () => {
    await boot();
    const gm = await admin();
    const id = idOf('w1', 'gm1');
    revoke(gm, id);
    await Promise.race([gm.next('pairings'), gm.untilClosed()]);
    expect(h!.store.getPairing(id)!.revokedAt).not.toBeNull();
  });

  it('answers a pairing of another world exactly like an unknown id, changing nothing', async () => {
    await boot();
    const gm = await admin();
    await pairWith({ worldId: 'w2', userId: 'other' });
    revoke(gm, idOf('w2', 'other'), 'a');
    revoke(gm, 'nope', 'b');
    const a = (await gm.next('error')) as Extract<LinkMessage, { type: 'error' }>;
    const b = (await gm.next('error')) as Extract<LinkMessage, { type: 'error' }>;
    expect(a).toMatchObject({ code: 'INVALID_ARGS', message: b.message });
    expect(h!.store.getPairing(idOf('w2', 'other'))!.revokedAt).toBeNull();
  });
});

describe('rate limit', () => {
  it('shares the invite window: 60 listInvites then listPairings is rate limited', async () => {
    await boot();
    const gm = await admin();
    for (let i = 0; i < MAX_INVITE_MESSAGES_PER_WINDOW; i++) {
      gm.send({ type: 'listInvites', requestId: `i${i}` });
      await gm.next('invites');
    }
    list(gm, 'over');
    expect(await gm.next('error')).toMatchObject({ code: 'RATE_LIMITED', requestId: 'over' });
  });

  it('counts both messages per window and recovers after it', async () => {
    await boot();
    const gm = await admin();
    for (let i = 0; i < MAX_INVITE_MESSAGES_PER_WINDOW; i++) {
      list(gm, `l${i}`);
      await gm.next('pairings');
    }
    revoke(gm, 'nope', 'over');
    expect(await gm.next('error')).toMatchObject({ code: 'RATE_LIMITED', requestId: 'over' });
    clock += INVITE_MESSAGE_WINDOW_MS;
    list(gm, 'later');
    expect(await gm.next('pairings')).toMatchObject({ requestId: 'later' });
  });
});
