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
  const { code } = createInvite(h!.store, { ...opts, gm: !opts.admin }, clock);
  const c = await TestClient.connect(h!.port, ORIGIN);
  clients.push(c);
  c.send(hello({ kind: 'pairingCode', code }, { worldId: opts.worldId, userId: opts.userId }));
  expect(await c.next()).toMatchObject({ type: 'welcome' });
  return c;
}
const admin = (worldId = 'w1', userId = 'gm1') => pairWith({ worldId, userId, admin: true });
const list = (c: TestClient, userId: string, requestId = 'r1') =>
  c.send({ type: 'listUserGrants', requestId, userId });
const revoke = (c: TestClient, userId: string, grantId: string, requestId = 'r1') =>
  c.send({ type: 'revokeUserGrant', requestId, userId, grantId });
const closeCode = (c: TestClient): Promise<number> =>
  new Promise((res) => c.ws.once('close', (code) => res(code)));
type UserGrants = Extract<LinkMessage, { type: 'userGrants' }>;
const ids = (m: LinkMessage) => (m as UserGrants).grants.map((g) => g.id).sort();

const SECRETS = {
  clientSecret: 'CLIENT-SECRET-hash-xyz',
  access: 'ACCESS-TOKEN-hash-abc',
  refresh: 'REFRESH-TOKEN-hash-def',
};

function seed(id: string, worldId: string, userId: string, clientName = 'App'): void {
  const oauth = h!.store.oauth;
  const clientId = `c-${id}`;
  oauth.createClient({
    id: clientId,
    secretHash: SECRETS.clientSecret,
    name: clientName,
    redirectUris: ['https://c.example/cb'],
    createdAt: 1,
  });
  oauth.createGrant({ id, clientId, worldId, userId, scopes: ['read', 'write'], createdAt: 5 });
  for (const [kind, hash] of [
    ['access', `${SECRETS.access}-${id}`],
    ['refresh', `${SECRETS.refresh}-${id}`],
  ] as const)
    oauth.insertToken({
      tokenHash: hash,
      kind,
      grantId: id,
      familyId: id,
      audience: 'a',
      expiresAt: clock + 60_000,
    });
}

describe('who may view or revoke a user grants', () => {
  it('refuses a non-admin whose hello says isGM, changing nothing', async () => {
    await boot();
    await admin();
    const p = await pairWith({ worldId: 'w1', userId: 'p1' });
    seed('g1', 'w1', 'p1');
    list(p, 'p1');
    revoke(p, 'p1', 'g1', 'r2');
    for (const id of ['r1', 'r2'])
      expect(await p.next('error')).toMatchObject({ code: 'FORBIDDEN', requestId: id });
    expect(h!.store.oauth.getGrant('g1')!.revokedAt).toBeNull();
  });

  it('refuses an admin demoted between two messages', async () => {
    await boot();
    const gm = await admin();
    await pairWith({ worldId: 'w1', userId: 'p1' });
    list(gm, 'p1');
    expect(await gm.next()).toMatchObject({ type: 'userGrants' });
    const id = h!.store.listActivePairings().find((p) => p.userId === 'gm1')!.id;
    h!.store.demotePairing(id);
    list(gm, 'p1', 'r2');
    expect(await gm.next('error')).toMatchObject({ code: 'FORBIDDEN', requestId: 'r2' });
  });

  it('rejects a message carrying a world id', async () => {
    await boot();
    const gm = await admin();
    gm.send({ type: 'listUserGrants', requestId: 'r', userId: 'p1', worldId: 'w2' });
    await gm.untilClosed();
    expect(gm.closed).toBe(true);
  });
});

describe('world scope', () => {
  it('lists and revokes only this world, treating a foreign grant id as unknown', async () => {
    await boot();
    const gm = await admin('w1');
    await pairWith({ worldId: 'w1', userId: 'p1' });
    seed('gA', 'w1', 'p1');
    seed('gB', 'w2', 'p1');
    list(gm, 'p1');
    const reply = await gm.next('userGrants');
    expect(ids(reply)).toEqual(['gA']);
    expect(reply).toMatchObject({ requestId: 'r1', userId: 'p1' });

    revoke(gm, 'p1', 'gB', 'r2');
    const foreign = await gm.next('error');
    revoke(gm, 'p1', 'nope', 'r3');
    const unknown = await gm.next('error');
    // The answer to a foreign id matches the answer to an unknown id.
    expect(foreign).toMatchObject({ code: 'INVALID_ARGS', requestId: 'r2' });
    expect(unknown).toMatchObject({ code: 'INVALID_ARGS', requestId: 'r3' });
    expect((foreign as { message: string }).message).toBe((unknown as { message: string }).message);
    expect(h!.store.oauth.getGrant('gB')!.revokedAt).toBeNull();
    expect(h!.store.oauth.getGrant('gA')!.revokedAt).toBeNull();

    revoke(gm, 'p1', 'gA', 'r4');
    expect(ids(await gm.next('userGrants'))).toEqual([]);
    expect(h!.store.oauth.getGrant('gA')!.revokedAt).not.toBeNull();
    expect(h!.store.oauth.getGrant('gB')!.revokedAt).toBeNull();
  });

  it('does not touch a different user of the same world', async () => {
    await boot();
    const gm = await admin('w1');
    seed('g1', 'w1', 'p1');
    seed('g2', 'w1', 'p2');
    revoke(gm, 'p1', 'g2');
    await gm.next('error');
    expect(h!.store.oauth.getGrant('g2')!.revokedAt).toBeNull();
  });
});

describe('another admin', () => {
  it('refuses list and revoke for a user holding another admin pairing', async () => {
    await boot();
    const gm = await admin('w1', 'gm1');
    await admin('w1', 'gm2');
    seed('g1', 'w1', 'gm2');
    list(gm, 'gm2');
    revoke(gm, 'gm2', 'g1', 'r2');
    for (const id of ['r1', 'r2'])
      expect(await gm.next('error')).toMatchObject({ code: 'FORBIDDEN', requestId: id });
    expect(h!.store.oauth.getGrant('g1')!.revokedAt).toBeNull();
  });

  it('lets the admin view and revoke its own grants', async () => {
    await boot();
    const gm = await admin('w1', 'gm1');
    seed('g1', 'w1', 'gm1');
    list(gm, 'gm1');
    expect(ids(await gm.next('userGrants'))).toEqual(['g1']);
    revoke(gm, 'gm1', 'g1', 'r2');
    expect(ids(await gm.next('userGrants'))).toEqual([]);
  });
});

describe('a pairing in another world', () => {
  it('does not block this world admin from the same user id', async () => {
    await boot();
    const gm = await admin('w1', 'gm1');
    await admin('w2', 'p1');
    seed('g1', 'w1', 'p1');
    list(gm, 'p1');
    expect(ids(await gm.next('userGrants'))).toEqual(['g1']);
  });
});

describe('a replaced connection', () => {
  it('is closed with 1008 and revokes nothing', async () => {
    await boot();
    const gm = await admin();
    seed('g1', 'w1', 'p1');
    h!.registry.remove(h!.registry.get('w1', 'gm1')!);
    const code1 = closeCode(gm);
    revoke(gm, 'p1', 'g1');
    await gm.untilClosed();
    expect(await code1).toBe(1008);
    expect(h!.store.oauth.getGrant('g1')!.revokedAt).toBeNull();
    const gm2 = await admin('w1', 'gmS');
    h!.registry.remove(h!.registry.get('w1', 'gmS')!);
    const code2 = closeCode(gm2);
    list(gm2, 'p1');
    await gm2.untilClosed();
    expect(await code2).toBe(1008);
    expect(gm2.messages.filter((m) => m.type === 'userGrants' || m.type === 'error')).toEqual([]);
  });
});

describe('what the reply carries', () => {
  it('has only grant summary fields and none of the seeded secrets', async () => {
    await boot();
    const gm = await admin();
    seed('g1', 'w1', 'p1', 'Claude');
    list(gm, 'p1');
    const reply = await gm.next('userGrants');
    const text = JSON.stringify(reply);
    for (const s of Object.values(SECRETS)) expect(text).not.toContain(s);
    expect(text).not.toMatch(/token|secret|hash/i);
    expect((reply as UserGrants).grants[0]).toEqual({
      id: 'g1',
      clientName: 'Claude',
      scopes: ['read', 'write'],
      createdAt: 5,
    });
    revoke(gm, 'p1', 'g1', 'r2');
    const after = JSON.stringify(await gm.next('userGrants'));
    for (const s of Object.values(SECRETS)) expect(after).not.toContain(s);
  });
});

describe('rate limit', () => {
  it('shares the window with pairing and invite messages', async () => {
    await boot();
    const gm = await admin();
    const half = MAX_INVITE_MESSAGES_PER_WINDOW / 2;
    for (let i = 0; i < half; i++) {
      gm.send({ type: 'listPairings', requestId: `p${i}` });
      await gm.next('pairings');
      gm.send({ type: 'listInvites', requestId: `i${i}` });
      await gm.next('invites');
    }
    list(gm, 'p1', 'over');
    expect(await gm.next('error')).toMatchObject({ code: 'RATE_LIMITED', requestId: 'over' });
  });

  it('shares the invite window across list and revoke and recovers after it', async () => {
    await boot();
    const gm = await admin();
    for (let i = 0; i < MAX_INVITE_MESSAGES_PER_WINDOW; i++) {
      list(gm, 'p1', `l${i}`);
      await gm.next('userGrants');
    }
    revoke(gm, 'p1', 'g', 'over');
    expect(await gm.next('error')).toMatchObject({ code: 'RATE_LIMITED', requestId: 'over' });
    clock += INVITE_MESSAGE_WINDOW_MS;
    list(gm, 'p1', 'later');
    expect(await gm.next('userGrants')).toMatchObject({ requestId: 'later' });
  });
});
