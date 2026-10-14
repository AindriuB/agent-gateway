import { afterEach, describe, expect, it } from 'vitest';
import type { LinkMessage } from '@agent-gateway/protocol';
import {
  AttestLimiter,
  ATTEST_WINDOW_MS,
  MAX_ATTESTS_PER_AUTHOR,
  MAX_ATTESTS_PER_WINDOW,
  MAX_ATTEST_AUTHORS,
  MAX_PENDING_PAIRINGS_PER_WORLD,
  MAX_PENDING_PAIRINGS_TOTAL,
  PAIRING_CHALLENGE_TTL_MS,
  PendingPairings,
} from '../../src/link/attestation.js';
import { createInvite, hashInviteCode } from '../../src/link/invites.js';
import { MAX_FAILED_CODE_ATTEMPTS_PER_CLIENT } from '../../src/link/code-attempts.js';
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

async function connect(): Promise<TestClient> {
  const c = await TestClient.connect(h!.port, ORIGIN);
  clients.push(c);
  return c;
}

/** Pair an admin GM through an operator admin invite and keep its link open. */
async function admin(worldId = 'w1', userId = 'gm1'): Promise<TestClient> {
  const { code } = createInvite(h!.store, { worldId, userId, admin: true }, clock);
  const c = await connect();
  c.send(hello({ kind: 'pairingCode', code }, { worldId, userId }));
  expect(await c.next()).toMatchObject({ type: 'welcome', admin: true });
  return c;
}

const plain = (userId = 'p1', worldId = 'w1') => createInvite(h!.store, { worldId, userId }, clock);

/** A player's hello with a plain invite; returns the socket and its first answer. */
async function player(
  code: string,
  who: { userId?: string; worldId?: string; isGM?: boolean } = {},
): Promise<{ c: TestClient; first: LinkMessage }> {
  const c = await connect();
  c.send(hello({ kind: 'pairingCode', code }, { userId: 'p1', ...who }));
  return { c, first: await c.next() };
}

const challenge = (m: LinkMessage): string => {
  expect(m).toMatchObject({ type: 'pairingChallenge' });
  return (m as { nonce: string }).nonce;
};

const attest = (c: TestClient, nonce: string, authorId: string, authorIsGM = false): void =>
  c.send({ type: 'attest', nonce, authorId, authorIsGM });

/** Settle the event loop so a message sent over the wire has been handled. */
async function flush(c: TestClient): Promise<void> {
  c.send({ type: 'ping' });
  await c.next('pong');
}

const invite = (code: string) => h!.store.invites.findByHash(hashInviteCode(code))!;

describe('the vouch', () => {
  it('a plain invite with no admin live is refused PAIRING_UNCONFIRMED and stays unused', async () => {
    await boot();
    const inv = plain();
    const { first } = await player(inv.code);
    expect(first).toMatchObject({ type: 'reject', code: 'PAIRING_UNCONFIRMED' });
    expect(invite(inv.code).usedAt).toBeNull();
  });

  it('with an admin live the invite is reserved, not spent: a challenge, no welcome, no registration', async () => {
    await boot();
    await admin();
    const inv = plain();
    const { c, first } = await player(inv.code);
    const nonce = challenge(first);
    expect(nonce.length).toBeGreaterThanOrEqual(22);
    expect((first as { expiresAt: number }).expiresAt).toBe(clock + PAIRING_CHALLENGE_TTL_MS);
    expect(invite(inv.code).usedAt).toBeNull();
    expect(h!.registry.get('w1', 'p1')).toBeUndefined();
    expect(c.messages).toEqual([]);
  });

  it('an attest from an admin for the right author, not a GM, completes the pairing', async () => {
    await boot();
    const gm = await admin();
    const inv = plain();
    const { c, first } = await player(inv.code);
    attest(gm, challenge(first), 'p1');
    const welcome = await c.next('welcome');
    expect(welcome).toMatchObject({ type: 'welcome', admin: false });
    const row = h!.store.listActivePairings().find((p) => p.userId === 'p1')!;
    expect(row).toMatchObject({ admin: false, worldId: 'w1', origin: ORIGIN });
    expect(invite(inv.code)).toMatchObject({ result: 'paired', pairingId: row.id });
    expect(h!.registry.get('w1', 'p1')).toBeDefined();
  });

  it("a re-pair replaces the target's old pairings", async () => {
    await boot();
    const gm = await admin();
    const a = plain();
    const first1 = await player(a.code);
    attest(gm, challenge(first1.first), 'p1');
    await first1.c.next('welcome');
    const oldId = h!.store.listActivePairings().find((p) => p.userId === 'p1')!.id;
    const b = plain();
    const second = await player(b.code);
    attest(gm, challenge(second.first), 'p1');
    await second.c.next('welcome');
    expect(h!.store.getPairing(oldId)?.revokedAt).not.toBeNull();
    expect(h!.store.listActivePairings().filter((p) => p.userId === 'p1')).toHaveLength(1);
  });

  it('a hello with isGM true on a plain invite still needs a vouch, and its pairing is not admin', async () => {
    await boot();
    const gm = await admin();
    const inv = plain();
    const { c, first } = await player(inv.code, { isGM: true });
    attest(gm, challenge(first), 'p1');
    expect(await c.next('welcome')).toMatchObject({ admin: false });
    expect(h!.store.listActivePairings().find((p) => p.userId === 'p1')!.admin).toBe(false);
  });

  describe('who may attest', () => {
    it('a connection whose hello says isGM but whose pairing is not admin is FORBIDDEN, and nothing pairs', async () => {
      await boot();
      await admin();
      // A GM paired by a gm invite: hello.isGM true, pairing.admin 0.
      const g = createInvite(h!.store, { worldId: 'w1', userId: 'gm2', gm: true }, clock);
      const fake = await connect();
      fake.send(hello({ kind: 'pairingCode', code: g.code }, { userId: 'gm2', isGM: true }));
      expect(await fake.next()).toMatchObject({ type: 'welcome', admin: false });
      const inv = plain();
      const { c, first } = await player(inv.code);
      attest(fake, challenge(first), 'p1');
      expect(await fake.next('error')).toMatchObject({ code: 'FORBIDDEN' });
      expect(c.messages).toEqual([]);
      expect(invite(inv.code).usedAt).toBeNull();
      expect(h!.store.listActivePairings().some((p) => p.userId === 'p1')).toBe(false);
    });

    it('an admin demoted after connecting can no longer attest (the row is read per message)', async () => {
      await boot();
      const gm = await admin();
      const inv = plain();
      const { c, first } = await player(inv.code);
      const row = h!.store.listActivePairings().find((p) => p.userId === 'gm1')!;
      expect(h!.store.demotePairing(row.id)).toBe(true);
      attest(gm, challenge(first), 'p1');
      expect(await gm.next('error')).toMatchObject({ code: 'FORBIDDEN' });
      expect(c.messages).toEqual([]);
    });

    it('a revoked admin pairing cannot attest', async () => {
      await boot();
      const gm = await admin();
      const inv = plain();
      const { first } = await player(inv.code);
      const row = h!.store.listActivePairings().find((p) => p.userId === 'gm1')!;
      h!.store.revokePairing(row.id);
      attest(gm, challenge(first), 'p1');
      // The revoke may close the link first; either answer leaves the invite unused.
      await new Promise((r) => setTimeout(r, 50));
      expect(invite(inv.code).usedAt).toBeNull();
    });

    it('a stale (replaced) admin connection is closed, not obeyed', async () => {
      await boot();
      const old = await admin();
      const inv = plain();
      const { first } = await player(inv.code);
      const nonce = challenge(first);
      // Replace: the same pairing token reconnects, so the first link is stale.
      const conn = h!.registry.get('w1', 'gm1')!;
      h!.registry.remove(conn);
      attest(old, nonce, 'p1');
      await old.untilClosed();
      expect(invite(inv.code).usedAt).toBeNull();
    });
  });

  describe('conditions', () => {
    it('an unknown nonce is ignored', async () => {
      await boot();
      const gm = await admin();
      attest(gm, 'nope', 'p1');
      await flush(gm);
      expect(gm.messages).toEqual([]);
    });

    it("a different world's admin changes nothing (cross-world isolation)", async () => {
      await boot();
      const gmA = await admin('w1', 'gm1');
      const other = await admin('w2', 'gmB');
      const inv = plain('p1', 'w1');
      const { c, first } = await player(inv.code);
      const nonce = challenge(first);
      attest(other, nonce, 'p1');
      await flush(other);
      expect(c.messages).toEqual([]);
      expect(invite(inv.code).usedAt).toBeNull();
      expect(h!.registry.get('w1', 'p1')).toBeUndefined();
      // Still pending: the right world's admin can complete it.
      attest(gmA, nonce, 'p1');
      expect(await c.next('welcome')).toMatchObject({ type: 'welcome' });
    });

    it('a wrong author spends the invite as mismatch, rejects PAIRING_INVALID and charges the client', async () => {
      await boot();
      const gm = await admin();
      const inv = plain();
      const { c, first } = await player(inv.code);
      attest(gm, challenge(first), 'thief');
      expect(await c.next()).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
      expect(invite(inv.code)).toMatchObject({ result: 'mismatch', pairingId: null });
      expect(h!.store.listActivePairings().some((p) => p.userId === 'thief')).toBe(false);
      expect(h!.store.listActivePairings().some((p) => p.userId === 'p1')).toBe(false);
    });

    it("a mismatch is charged to the pending socket's client key", async () => {
      await boot();
      const gm = await admin();
      // Fill the per-client bucket with mismatches; the next code hello is RATE_LIMITED.
      for (let i = 0; i < MAX_FAILED_CODE_ATTEMPTS_PER_CLIENT; i++) {
        const inv = plain(`p${i}`);
        const { first } = await player(inv.code, { userId: `p${i}` });
        attest(gm, challenge(first), 'thief');
        await Promise.resolve();
      }
      await new Promise((r) => setTimeout(r, 50));
      const inv = plain('late');
      const { first } = await player(inv.code, { userId: 'late' });
      expect(first).toMatchObject({ type: 'reject', code: 'RATE_LIMITED' });
      expect(invite(inv.code).usedAt).toBeNull();
    });

    it('a GM author is refused PAIRING_UNCONFIRMED with the operator hint; the invite is unused', async () => {
      await boot();
      const gm = await admin();
      const inv = plain();
      const { c, first } = await player(inv.code);
      attest(gm, challenge(first), 'p1', true);
      const r = await c.next();
      expect(r).toMatchObject({ type: 'reject', code: 'PAIRING_UNCONFIRMED' });
      expect((r as { message: string }).message).toContain('--gm');
      expect(invite(inv.code).usedAt).toBeNull();
    });

    it('a nonce is single-use', async () => {
      await boot();
      const gm = await admin();
      const inv = plain();
      const { c, first } = await player(inv.code);
      const nonce = challenge(first);
      attest(gm, nonce, 'p1');
      await c.next('welcome');
      const before = h!.store.listPairings().length;
      attest(gm, nonce, 'p1');
      await flush(gm);
      expect(h!.store.listPairings()).toHaveLength(before);
    });

    it('a cancelled invite does not pair at attest time', async () => {
      await boot();
      const gm = await admin();
      const inv = plain();
      const { c, first } = await player(inv.code);
      h!.store.invites.cancelFor('w1', 'p1');
      attest(gm, challenge(first), 'p1');
      expect(await c.next()).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
      expect(h!.store.listActivePairings().some((p) => p.userId === 'p1')).toBe(false);
    });
  });

  describe('lifetime', () => {
    it('closing the pending socket releases the reservation; the invite stays unused', async () => {
      await boot();
      const gm = await admin();
      const inv = plain();
      const a = await player(inv.code);
      const nonce = challenge(a.first);
      a.c.ws.close();
      await a.c.untilClosed();
      // Straight away, before any attest could free the reservation as a side effect.
      const b = await player(inv.code);
      challenge(b.first);
      expect(invite(inv.code).usedAt).toBeNull();
      attest(gm, nonce, 'p1');
      await flush(gm);
      expect(invite(inv.code).usedAt).toBeNull();
    });

    it('expiry rejects the socket PAIRING_UNCONFIRMED and releases the reservation', async () => {
      await boot();
      const gm = await admin();
      const inv = plain();
      const { c, first } = await player(inv.code);
      const nonce = challenge(first);
      clock += PAIRING_CHALLENGE_TTL_MS + 1;
      h!.server.sweepPending();
      expect(await c.next()).toMatchObject({ type: 'reject', code: 'PAIRING_UNCONFIRMED' });
      expect(invite(inv.code).usedAt).toBeNull();
      attest(gm, nonce, 'p1');
      await flush(gm);
      expect(invite(inv.code).usedAt).toBeNull();
    });

    it('an attest after the TTL, before any sweep, is too late', async () => {
      await boot();
      const gm = await admin();
      const inv = plain();
      const { c, first } = await player(inv.code);
      clock += PAIRING_CHALLENGE_TTL_MS + 1;
      attest(gm, challenge(first), 'p1');
      expect(await c.next()).toMatchObject({ type: 'reject', code: 'PAIRING_UNCONFIRMED' });
      expect(invite(inv.code).usedAt).toBeNull();
    });

    it('a second hello with a reserved code is refused and does not disturb the first', async () => {
      await boot();
      const gm = await admin();
      const inv = plain();
      const a = await player(inv.code);
      const nonce = challenge(a.first);
      const b = await player(inv.code);
      expect(b.first).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
      expect(invite(inv.code).usedAt).toBeNull();
      attest(gm, nonce, 'p1');
      expect(await a.c.next('welcome')).toMatchObject({ type: 'welcome' });
    });
  });

  describe('bounds', () => {
    it('refuses a hello beyond the per-world cap with RATE_LIMITED and spends nothing', async () => {
      await boot();
      await admin();
      for (let i = 0; i < MAX_PENDING_PAIRINGS_PER_WORLD; i++) {
        // Distinct client keys are not possible here; step the per-client limiter is not involved.
        const inv = plain(`p${i}`);
        const { first } = await player(inv.code, { userId: `p${i}` });
        challenge(first);
      }
      const inv = plain('over');
      const { first } = await player(inv.code, { userId: 'over' });
      expect(first).toMatchObject({ type: 'reject', code: 'RATE_LIMITED' });
      expect(invite(inv.code).usedAt).toBeNull();
    });

    it("one author spamming past their budget does not block another author's vouch", async () => {
      await boot();
      const gm = await admin();
      const inv = plain();
      const { c, first } = await player(inv.code);
      const nonce = challenge(first);
      for (let i = 0; i < MAX_ATTESTS_PER_AUTHOR; i++) attest(gm, `unknown-${i}`, 'spammer');
      await flush(gm);
      expect(gm.messages).toEqual([]);
      attest(gm, 'one-more', 'spammer');
      expect(await gm.next('error')).toMatchObject({ code: 'RATE_LIMITED' });
      attest(gm, nonce, 'p1');
      expect(await c.next('welcome')).toMatchObject({ type: 'welcome' });
    });

    it('the per-connection ceiling still holds across many authors', async () => {
      await boot();
      const gm = await admin();
      const authors = MAX_ATTESTS_PER_WINDOW / MAX_ATTESTS_PER_AUTHOR;
      for (let a = 0; a < authors; a++)
        for (let i = 0; i < MAX_ATTESTS_PER_AUTHOR; i++) attest(gm, `u-${a}-${i}`, `author-${a}`);
      await flush(gm);
      expect(gm.messages).toEqual([]);
      attest(gm, 'over-ceiling', 'fresh-author');
      expect(await gm.next('error')).toMatchObject({ code: 'RATE_LIMITED' });
    });
  });
});

describe('PendingPairings', () => {
  const claim = (worldId: string, userId = 'u') => ({
    worldId,
    userId,
    userName: 'n',
    origin: 'o',
  });
  const inviteRow = (id: string, worldId: string) => ({ id, worldId, userId: 'u' }) as never;

  it('caps per world and in total, with named constants', () => {
    const p = new PendingPairings<number>(() => 0);
    for (let i = 0; i < MAX_PENDING_PAIRINGS_PER_WORLD; i++)
      expect(p.reserve(inviteRow(`i${i}`, 'a'), claim('a'), 'c', {}, 0).ok).toBe(true);
    expect(p.reserve(inviteRow('x', 'a'), claim('a'), 'c', {}, 0)).toEqual({
      ok: false,
      reason: 'capacity',
    });
    let n = MAX_PENDING_PAIRINGS_PER_WORLD;
    for (let w = 0; n < MAX_PENDING_PAIRINGS_TOTAL; w++) {
      for (let i = 0; i < MAX_PENDING_PAIRINGS_PER_WORLD && n < MAX_PENDING_PAIRINGS_TOTAL; i++) {
        expect(p.reserve(inviteRow(`w${w}-${i}`, `w${w}`), claim(`w${w}`), 'c', {}, 0).ok).toBe(
          true,
        );
        n++;
      }
    }
    expect(p.size).toBe(MAX_PENDING_PAIRINGS_TOTAL);
    expect(p.reserve(inviteRow('last', 'fresh'), claim('fresh'), 'c', {}, 0)).toEqual({
      ok: false,
      reason: 'capacity',
    });
  });

  it('issues distinct 128-bit nonces and honours the TTL', () => {
    let t = 10;
    const p = new PendingPairings<number>(() => t);
    const a = p.reserve(inviteRow('1', 'a'), claim('a'), 'c', {}, 0);
    const b = p.reserve(inviteRow('2', 'a'), claim('a'), 'c', {}, 0);
    if (!a.ok || !b.ok) throw new Error('reserve failed');
    expect(a.pending.nonce).not.toBe(b.pending.nonce);
    expect(Buffer.from(a.pending.nonce, 'base64url')).toHaveLength(16);
    expect(a.pending.expiresAt).toBe(10 + PAIRING_CHALLENGE_TTL_MS);
    t += PAIRING_CHALLENGE_TTL_MS;
    expect(p.get(a.pending.nonce)).toBeUndefined();
    expect(p.sweep()).toHaveLength(2);
    expect(p.size).toBe(0);
  });

  it('AttestLimiter budgets per author, caps the author table, and resets after the window', () => {
    let t = 0;
    const l = new AttestLimiter(() => t, 100, ATTEST_WINDOW_MS, 3, 2);
    expect([1, 2, 3, 4].map(() => l.allow('a'))).toEqual([true, true, true, false]);
    expect(l.allow('b')).toBe(true);
    expect(l.allow('c')).toBe(false); // table full of live windows (MAX_ATTEST_AUTHORS)
    t += ATTEST_WINDOW_MS;
    expect(l.allow('c')).toBe(true); // expired windows are pruned
    expect(l.allow('a')).toBe(true);
    expect(MAX_ATTEST_AUTHORS).toBeGreaterThan(MAX_ATTESTS_PER_WINDOW / MAX_ATTESTS_PER_AUTHOR);
  });
});
