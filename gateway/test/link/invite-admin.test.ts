import { afterEach, describe, expect, it } from 'vitest';
import { parseLinkMessage, type LinkMessage } from '@agent-gateway/protocol';
import {
  CREATE_WINDOW_MS,
  INVITE_MESSAGE_WINDOW_MS,
  MAX_CREATES_PER_WINDOW,
  MAX_INVITE_MESSAGES_PER_WINDOW,
  MAX_OPEN_INVITES_PER_WORLD,
  MAX_TRACKED_CREATORS,
  MIN_DELEGATED_TTL_MS,
  CreateLimiter,
} from '../../src/link/invite-admin.js';
import {
  INVITE_TTL_MS,
  MAX_INVITE_TTL_MS,
  createInvite,
  hashInviteCode,
  redeemInvite,
} from '../../src/link/invites.js';
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
  gm?: boolean;
}): Promise<TestClient> {
  const { code } = createInvite(h!.store, opts, clock);
  const c = await TestClient.connect(h!.port, ORIGIN);
  clients.push(c);
  c.send(hello({ kind: 'pairingCode', code }, { worldId: opts.worldId, userId: opts.userId }));
  expect(await c.next()).toMatchObject({ type: 'welcome' });
  return c;
}
const admin = (worldId = 'w1', userId = 'gm1') => pairWith({ worldId, userId, admin: true });

const create = (c: TestClient, userId = 'p1', extra: object = {}, requestId = 'r1') =>
  c.send({ type: 'createInvite', requestId, userId, ...extra });
const list = (c: TestClient, requestId = 'r1') => c.send({ type: 'listInvites', requestId });
const cancel = (c: TestClient, inviteId: string, requestId = 'r1') =>
  c.send({ type: 'cancelInvite', requestId, inviteId });

type Invites = Extract<LinkMessage, { type: 'invites' }>['invites'];
const invitesOf = (m: LinkMessage): Invites =>
  (m as Extract<LinkMessage, { type: 'invites' }>).invites;
const created = async (c: TestClient) =>
  (await c.next('inviteCreated')) as Extract<LinkMessage, { type: 'inviteCreated' }>;

describe('protocol shape on the wire', () => {
  it('a message carrying a world id closes the socket 1008', async () => {
    await boot();
    const gm = await admin();
    gm.send({ type: 'listInvites', requestId: 'r', worldId: 'w2' });
    await gm.untilClosed();
    expect(gm.closed).toBe(true);
  });
});

describe('who may manage invites', () => {
  it('refuses a non-admin whose hello says isGM for all three messages, changing nothing', async () => {
    await boot();
    const plainGm = await pairWith({ worldId: 'w1', userId: 'gm2', gm: true });
    const before = h!.store.invites.list().length;
    create(plainGm);
    list(plainGm, 'r2');
    cancel(plainGm, 'x', 'r3');
    for (const id of ['r1', 'r2', 'r3'])
      expect(await plainGm.next('error')).toMatchObject({ code: 'FORBIDDEN', requestId: id });
    expect(h!.store.invites.list()).toHaveLength(before);
  });

  it('refuses a connection demoted between two messages on the second', async () => {
    await boot();
    const gm = await admin();
    list(gm);
    expect(await gm.next()).toMatchObject({ type: 'invites' });
    const row = h!.store.listActivePairings().find((p) => p.userId === 'gm1')!;
    h!.store.demotePairing(row.id);
    create(gm);
    expect(await gm.next()).toMatchObject({ type: 'error', code: 'FORBIDDEN', requestId: 'r1' });
    expect(h!.store.invites.list().filter((i) => i.createdBy !== null)).toHaveLength(0);
  });

  it('refuses a revoked pairing on its still-open connection', async () => {
    await boot();
    const gm = await admin();
    const row = h!.store.listActivePairings().find((p) => p.userId === 'gm1')!;
    h!.store.revokePairing(row.id);
    list(gm);
    // Either the revoke closed the link or the handler refused; nothing is listed.
    await Promise.race([gm.next('error'), gm.untilClosed()]);
    expect(gm.messages.filter((m) => m.type === 'invites')).toHaveLength(0);
  });
});

describe('createInvite', () => {
  it('stores a world-bound, non-admin, attributed invite and returns the code once', async () => {
    await boot();
    const gm = await admin();
    const gmRow = h!.store.listActivePairings().find((p) => p.userId === 'gm1')!;
    create(gm);
    const r = await created(gm);
    const row = h!.store.invites.getById(r.inviteId)!;
    expect(row).toMatchObject({
      worldId: 'w1',
      userId: 'p1',
      admin: false,
      gm: false,
      createdBy: gmRow.id,
      expiresAt: clock + INVITE_TTL_MS,
    });
    expect(r.expiresAt).toBe(clock + INVITE_TTL_MS);
    expect(row.codeHash).toBe(hashInviteCode(r.code));
    expect(JSON.stringify(row)).not.toContain(r.code);
    list(gm, 'r2');
    expect(JSON.stringify(await gm.next('invites'))).not.toContain(r.code);
  });

  it('honours a ttl and refuses one above the cap or at or below zero', async () => {
    await boot();
    const gm = await admin();
    create(gm, 'p1', { ttlMs: MIN_DELEGATED_TTL_MS });
    expect((await created(gm)).expiresAt).toBe(clock + MIN_DELEGATED_TTL_MS);
    create(gm, 'p1', { ttlMs: MAX_INVITE_TTL_MS });
    await created(gm);
    for (const ttlMs of [MAX_INVITE_TTL_MS + 1, MIN_DELEGATED_TTL_MS - 1, 1, 0, -5]) {
      create(gm, 'p1', { ttlMs });
      expect(await gm.next('error')).toMatchObject({ code: 'INVALID_ARGS', requestId: 'r1' });
    }
    expect(h!.store.invites.list().filter((i) => i.createdBy !== null)).toHaveLength(2);
  });

  it('refuses a target that holds an active admin pairing, writing nothing', async () => {
    await boot();
    const gm = await admin();
    await admin('w1', 'gm2');
    create(gm, 'gm2');
    expect(await gm.next('error')).toMatchObject({ code: 'FORBIDDEN' });
    create(gm, 'gm1');
    expect(await gm.next('error')).toMatchObject({ code: 'FORBIDDEN' });
    expect(h!.store.invites.list().filter((i) => i.createdBy !== null)).toHaveLength(0);
  });

  it('an admin in another world does not block the same user id here', async () => {
    await boot();
    const gm = await admin('w1', 'gm1');
    await admin('w2', 'p1');
    create(gm, 'p1');
    await created(gm);
  });
});

describe('redeeming a delegated invite', () => {
  it('is refused PAIRING_INVALID and settled mismatch if the target became an admin meanwhile', async () => {
    await boot();
    const gm = await admin();
    create(gm, 'p1');
    const r = await created(gm);
    await admin('w1', 'p1');
    const c = await TestClient.connect(h!.port, ORIGIN);
    clients.push(c);
    c.send(hello({ kind: 'pairingCode', code: r.code }, { userId: 'p1' }));
    expect(await c.next()).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
    expect(h!.store.invites.getById(r.inviteId)).toMatchObject({ result: 'mismatch' });
    expect(h!.store.listActivePairings().filter((p) => p.userId === 'p1')).toHaveLength(1);
    expect(h!.store.listActivePairings().find((p) => p.userId === 'p1')!.admin).toBe(true);
  });

  it('refuses the attest if the target became an admin between challenge and attest', async () => {
    await boot();
    const gm = await admin();
    create(gm, 'p1');
    const r = await created(gm);
    const p = await TestClient.connect(h!.port, ORIGIN);
    clients.push(p);
    p.send(hello({ kind: 'pairingCode', code: r.code }, { userId: 'p1', isGM: false }));
    const ch = (await p.next()) as { type: string; nonce: string };
    expect(ch.type).toBe('pairingChallenge');
    await admin('w1', 'p1');
    gm.send({ type: 'attest', nonce: ch.nonce, authorId: 'p1', authorIsGM: false });
    expect(await p.next()).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
    expect(h!.store.invites.getById(r.inviteId)).toMatchObject({ result: 'mismatch' });
    const mine = h!.store.listActivePairings().filter((x) => x.userId === 'p1');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.admin).toBe(true);
  });

  it('leaves operator invites unaffected by the admin check', async () => {
    await boot();
    await admin('w1', 'p1');
    const op = createInvite(h!.store, { worldId: 'w1', userId: 'p1' }, clock);
    const out = redeemInvite(
      h!.store,
      op.code,
      { worldId: 'w1', userId: 'p1', userName: 'P', origin: ORIGIN },
      clock,
    );
    expect(out).toMatchObject({ ok: false, reason: 'vouch' });
  });

  it('still needs 90s vouch: create, redeem, challenge, admin attest, welcome', async () => {
    await boot();
    const gm = await admin();
    create(gm, 'p1');
    const r = await created(gm);
    const p = await TestClient.connect(h!.port, ORIGIN);
    clients.push(p);
    p.send(hello({ kind: 'pairingCode', code: r.code }, { userId: 'p1', isGM: false }));
    const ch = (await p.next()) as { type: string; nonce: string };
    expect(ch.type).toBe('pairingChallenge');
    expect(h!.store.invites.getById(r.inviteId)?.usedAt).toBeNull();
    gm.send({ type: 'attest', nonce: ch.nonce, authorId: 'p1', authorIsGM: false });
    expect(await p.next('welcome')).toMatchObject({ type: 'welcome', admin: false });
    expect(h!.store.invites.getById(r.inviteId)).toMatchObject({ result: 'paired' });
  });
});

describe('stale connections', () => {
  it('closes a replaced connection and writes nothing for any of the three messages', async () => {
    await boot();
    const gm = await admin();
    h!.registry.remove(h!.registry.get('w1', 'gm1')!);
    create(gm);
    await gm.untilClosed();
    expect(h!.store.invites.list().filter((i) => i.createdBy !== null)).toHaveLength(0);
    expect(gm.messages.filter((m) => m.type === 'inviteCreated' || m.type === 'error')).toEqual([]);
    const gm2 = await admin('w1', 'gmS');
    h!.registry.remove(h!.registry.get('w1', 'gmS')!);
    list(gm2);
    await gm2.untilClosed();
    expect(gm2.messages.filter((m) => m.type === 'invites')).toEqual([]);
  });
});

describe('caps', () => {
  it('keeps the create limit across a token reconnect of the same pairing', async () => {
    await boot();
    const { code } = createInvite(h!.store, { worldId: 'w1', userId: 'gm1', admin: true }, clock);
    const first = await TestClient.connect(h!.port, ORIGIN);
    clients.push(first);
    first.send(hello({ kind: 'pairingCode', code }, { userId: 'gm1' }));
    const w = await first.next();
    if (w.type !== 'welcome' || !w.pairingToken) throw new Error('not paired');
    for (let i = 0; i < MAX_CREATES_PER_WINDOW; i++) {
      create(first, `p${i}`, {}, `c${i}`);
      await created(first);
    }
    const again = await TestClient.connect(h!.port, ORIGIN);
    clients.push(again);
    again.send(hello({ kind: 'pairingToken', token: w.pairingToken }, { userId: 'gm1' }));
    expect(await again.next()).toMatchObject({ type: 'welcome' });
    create(again, 'extra', {}, 'over');
    expect(await again.next('error')).toMatchObject({ code: 'RATE_LIMITED', requestId: 'over' });
    expect(h!.store.invites.list().filter((i) => i.userId === 'extra')).toHaveLength(0);
  });

  it('bounds the tracked pairing keys, evicting expired windows and refusing new keys when full', () => {
    const l = new CreateLimiter(3);
    expect(MAX_TRACKED_CREATORS).toBeGreaterThan(0);
    for (const k of ['a', 'b', 'c']) expect(l.allow(k, 1000)).toBe(true);
    expect(l.allow('d', 1000)).toBe(false);
    expect(l.size).toBe(3);
    expect(l.allow('a', 1000)).toBe(true);
    expect(l.allow('d', 1000 + CREATE_WINDOW_MS)).toBe(true);
    expect(l.size).toBeLessThanOrEqual(3);
  });

  it('limits creates per connection per window and writes nothing past it', async () => {
    await boot();
    const gm = await admin();
    for (let i = 0; i < MAX_CREATES_PER_WINDOW; i++) {
      create(gm, `p${i}`, {}, `c${i}`);
      await created(gm);
    }
    create(gm, 'extra', {}, 'over');
    expect(await gm.next('error')).toMatchObject({ code: 'RATE_LIMITED', requestId: 'over' });
    expect(h!.store.invites.list().filter((i) => i.userId === 'extra')).toHaveLength(0);
    clock += CREATE_WINDOW_MS;
    create(gm, 'later');
    await created(gm);
  });

  it('limits open invites per world, counting operator ones, and writes nothing past it', async () => {
    await boot();
    const gm = await admin();
    for (let i = 0; i < MAX_OPEN_INVITES_PER_WORLD; i++) {
      if (i > 0 && i % MAX_CREATES_PER_WINDOW === 0) clock += CREATE_WINDOW_MS;
      create(gm, `p${i}`);
      await created(gm);
    }
    clock += CREATE_WINDOW_MS;
    const total = h!.store.invites.list().length;
    create(gm, 'over');
    expect(await gm.next('error')).toMatchObject({ code: 'RATE_LIMITED' });
    expect(h!.store.invites.list()).toHaveLength(total);
    // Another world is unaffected, and a cancelled invite frees a slot.
    const gmB = await admin('w2', 'gmB');
    create(gmB, 'p1');
    await created(gmB);
    const open = h!.store.invites.list().find((i) => i.worldId === 'w1' && i.createdBy !== null)!;
    cancel(gm, open.id);
    await gm.next('invites');
    create(gm, 'over');
    await created(gm);
  });

  it('limits all three messages per connection per minute', async () => {
    await boot();
    const gm = await admin();
    for (let i = 0; i < MAX_INVITE_MESSAGES_PER_WINDOW; i++) {
      list(gm, `l${i}`);
      await gm.next('invites');
    }
    list(gm, 'over');
    expect(await gm.next('error')).toMatchObject({ code: 'RATE_LIMITED', requestId: 'over' });
    cancel(gm, 'x', 'over2');
    expect(await gm.next('error')).toMatchObject({ code: 'RATE_LIMITED', requestId: 'over2' });
    clock += INVITE_MESSAGE_WINDOW_MS;
    list(gm, 'again');
    expect(await gm.next()).toMatchObject({ type: 'invites', requestId: 'again' });
  });
});

describe('world isolation', () => {
  it('lists only the sender world and treats a foreign invite id like an unknown one', async () => {
    await boot();
    const a = await admin('wA', 'gmA');
    const b = await admin('wB', 'gmB');
    create(a, 'p1');
    const ra = await created(a);
    create(b, 'p2');
    const rb = await created(b);
    list(b);
    const seen = invitesOf(await b.next('invites'));
    expect(seen.map((i) => i.id)).toContain(rb.inviteId);
    expect(seen.every((i) => i.userId !== 'p1')).toBe(true);
    expect(JSON.stringify(seen)).not.toContain(ra.inviteId);

    cancel(b, ra.inviteId, 'foreign');
    const foreign = await b.next('error');
    cancel(b, 'no-such-id', 'unknown');
    const unknown = await b.next('error');
    expect(foreign).toMatchObject({ code: 'INVALID_ARGS', requestId: 'foreign' });
    expect({ ...foreign, requestId: '' }).toEqual({ ...unknown, requestId: '' });
    expect(h!.store.invites.getById(ra.inviteId)).toMatchObject({
      cancelledAt: null,
      usedAt: null,
    });
  });
});

describe('listInvites and cancelInvite', () => {
  it('lists id, user, times and status, never a code or hash', async () => {
    await boot();
    const gm = await admin();
    create(gm, 'p1');
    const r = await created(gm);
    list(gm, 'r2');
    const reply = await gm.next('invites');
    const text = JSON.stringify(reply);
    expect(text).not.toContain(r.code);
    expect(text).not.toContain(hashInviteCode(r.code));
    expect(invitesOf(reply).find((i) => i.id === r.inviteId)).toEqual({
      id: r.inviteId,
      userId: 'p1',
      createdAt: h!.store.invites.getById(r.inviteId)!.createdAt,
      expiresAt: r.expiresAt,
      status: 'unused',
    });
    clock += INVITE_TTL_MS + 1;
    list(gm, 'r3');
    expect(invitesOf(await gm.next('invites')).find((i) => i.id === r.inviteId)?.status).toBe(
      'expired',
    );
  });

  it('keeps an old open invite listed after more than 100 newer ones were cancelled', async () => {
    await boot();
    const gm = await admin();
    create(gm, 'old', { ttlMs: MAX_INVITE_TTL_MS }, 'o');
    const old = await created(gm);
    for (let i = 0; i < 105; i++) {
      clock += 1;
      const row = h!.store.invites.create({
        id: `n${i}`,
        codeHash: `hash-${i}`,
        worldId: 'w1',
        userId: 'p',
        origin: null,
        expiresAt: clock + 10_000,
      });
      h!.store.invites.cancelInWorld('w1', row.id);
    }
    list(gm, 'l');
    const reply = invitesOf(await gm.next('invites'));
    expect(reply.length).toBeLessThanOrEqual(100);
    expect(reply.find((i) => i.id === old.inviteId)?.status).toBe('unused');
    cancel(gm, old.inviteId, 'c');
    expect(await gm.next('invites')).toMatchObject({ requestId: 'c' });
    expect(h!.store.invites.getById(old.inviteId)?.cancelledAt).not.toBeNull();
  });

  it('cancels one unused invite and replies with the updated list', async () => {
    await boot();
    const gm = await admin();
    create(gm, 'p1', {}, 'a');
    const r1 = await created(gm);
    create(gm, 'p2', {}, 'b');
    const r2 = await created(gm);
    cancel(gm, r1.inviteId, 'c');
    const reply = (await gm.next('invites')) as Extract<LinkMessage, { type: 'invites' }>;
    expect(reply.requestId).toBe('c');
    const byId = Object.fromEntries(reply.invites.map((i) => [i.id, i.status]));
    expect(byId).toMatchObject({ [r1.inviteId]: 'cancelled', [r2.inviteId]: 'unused' });
    cancel(gm, r1.inviteId, 'd');
    expect(await gm.next('error')).toMatchObject({ code: 'INVALID_ARGS', requestId: 'd' });
  });
});

describe('open-invite cap and reply bound', () => {
  const seedRows = (n: number, prefix: string, cancelled: boolean) =>
    h!.store.transaction(() => {
      for (let i = 0; i < n; i++) {
        h!.store.invites.create({
          id: `${prefix}${i}`,
          codeHash: `h-${prefix}${i}`,
          worldId: 'w1',
          userId: `${prefix}u${i}`,
          origin: null,
          expiresAt: clock + INVITE_TTL_MS,
        });
        if (cancelled) h!.store.invites.cancelFor('w1', `${prefix}u${i}`);
      }
    });
  const reparsed = (m: LinkMessage) => {
    expect(parseLinkMessage(JSON.stringify(m)).ok).toBe(true);
    return invitesOf(m);
  };

  it('refuses the 101st open operator invite in a world, but not in another', async () => {
    await boot();
    const mint = (worldId: string) => () => createInvite(h!.store, { worldId, userId: 'x' }, clock);
    for (let i = 0; i < 100; i++) mint('w1')();
    expect(mint('w1')).toThrow(/100 open invites/);
    expect(h!.store.invites.countUnusedForWorld('w1', clock)).toBe(100);
    expect(mint('w2')).not.toThrow();
  });

  it('lists all 100 open and at most 200 entries beside 150 cancelled; the reply parses', async () => {
    await boot();
    const gm = await admin();
    seedRows(100, 'o', false);
    seedRows(150, 'c', true);
    list(gm);
    const got = reparsed(await gm.next('invites'));
    expect(got.length).toBeLessThanOrEqual(200);
    expect(got.filter((i) => i.status === 'unused')).toHaveLength(100);
  });

  it('clamps a reply to 200 for pre-cap data with more open invites', async () => {
    await boot();
    const gm = await admin();
    seedRows(250, 'o', false);
    list(gm);
    expect(reparsed(await gm.next('invites')).length).toBeLessThanOrEqual(200);
  });
});
