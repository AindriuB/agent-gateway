import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  INVITE_CODE_PATTERN,
  INVITE_TTL_MS,
  createInvite,
  hashInviteCode,
  parseTtl,
  type MemoryInviteProvider,
} from '../../src/link/invites.js';
import { MAX_FAILED_CODE_ATTEMPTS_PER_CLIENT } from '../../src/link/code-attempts.js';
import { hashToken, type OriginRejection } from '../../src/link/index.js';
import { ORIGIN, TestClient, hello, startServer, type Harness } from './helpers.js';

let h: Harness | undefined;
const clients: TestClient[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  await h?.server.close();
  h?.store.close();
  h = undefined;
});

let clock = 1_000_000;
const now = () => clock;

async function boot(over: Parameters<typeof startServer>[0] = {}): Promise<Harness> {
  clock = 1_000_000;
  h = await startServer({ serverMode: true, now, ...over });
  return h;
}
const invite = (
  over: {
    userId?: string;
    worldId?: string;
    origin?: string;
    ttlMs?: number;
    gm?: boolean;
  } = {},
) =>
  createInvite(
    h!.store,
    {
      worldId: over.worldId ?? 'w1',
      userId: over.userId ?? 'u1',
      origin: over.origin,
      ttlMs: over.ttlMs,
      // These tests are about the invite store; a gm invite pairs directly, without a vouch.
      gm: over.gm ?? true,
    },
    clock,
  );
async function redeem(
  code: string,
  who: { worldId?: string; userId?: string; origin?: string } = {},
): Promise<{ c: TestClient; first: Awaited<ReturnType<TestClient['next']>> }> {
  const c = await TestClient.connect(h!.port, who.origin ?? ORIGIN);
  clients.push(c);
  c.send(hello({ kind: 'pairingCode', code }, who));
  return { c, first: await c.next() };
}

describe('invite codes', () => {
  it('parses TTLs', () => {
    expect(parseTtl('30m')).toBe(30 * 60_000);
    expect(parseTtl('12h')).toBe(12 * 3_600_000);
    expect(parseTtl('7d')).toBe(7 * 86_400_000);
    for (const bad of ['8d', '0m', '', '5', 'h', '-1h', '1.5h', '169h', '10081m']) {
      expect(parseTtl(bad)).toBeUndefined();
    }
  });
});

describe('server mode redeem', () => {
  it('pairs the target, records the origin and returns a token', async () => {
    await boot();
    const inv = invite();
    expect(inv.code).toMatch(INVITE_CODE_PATTERN);
    expect(inv.expiresAt).toBe(clock + INVITE_TTL_MS);
    const { first } = await redeem(inv.code);
    expect(first).toMatchObject({ type: 'welcome' });
    const token = (first as { pairingToken?: string }).pairingToken!;
    const row = h!.store.findPairingByHash(hashToken(token))!;
    expect(row).toMatchObject({ worldId: 'w1', userId: 'u1', origin: ORIGIN, revokedAt: null });
    expect(h!.store.invites.findByHash(hashInviteCode(inv.code))).toMatchObject({
      result: 'paired',
      pairingId: row.id,
      usedAt: expect.any(Number),
    });
    expect(JSON.stringify(h!.store.invites.list())).not.toContain(inv.code);
  });

  it('a single-use invite cannot be redeemed twice', async () => {
    await boot();
    const inv = invite();
    expect((await redeem(inv.code)).first).toMatchObject({ type: 'welcome' });
    expect((await redeem(inv.code)).first).toMatchObject({
      type: 'reject',
      code: 'PAIRING_INVALID',
    });
  });

  it.each([
    ['world', { worldId: 'w2' }, {}],
    ['user', { userId: 'u2' }, {}],
    ['origin', {}, { origin: 'https://other.example' }],
  ])('a wrong %s is refused and the invite is spent', async (_n, who, pin) => {
    await boot({ allowedOrigins: undefined });
    const inv = invite({ origin: 'origin' in pin ? ORIGIN : undefined });
    const bad = await redeem(inv.code, { ...who, ...pin });
    expect(bad.first).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
    expect(h!.store.invites.findByHash(hashInviteCode(inv.code))).toMatchObject({
      result: 'mismatch',
    });
    expect((await redeem(inv.code)).first).toMatchObject({
      type: 'reject',
      code: 'PAIRING_INVALID',
    });
    expect(h!.store.listActivePairings()).toEqual([]);
  });

  it('refuses expired, used and unknown codes with one message, and each counts as a failure', async () => {
    await boot();
    const expired = invite({ ttlMs: 1000 });
    clock += 1000;
    const used = invite();
    await redeem(used.code);
    const msgs = [];
    for (const code of [expired.code, used.code, 'AAAA-AAAA-AAAA']) {
      msgs.push((await redeem(code)).first);
    }
    expect(new Set(msgs.map((m) => JSON.stringify(m))).size).toBe(1);
    expect(msgs[0]).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
    expect(h!.store.invites.findByHash(hashInviteCode(expired.code))).toMatchObject({
      result: 'expired',
    });
    // Five failures so far on one client key: the sixth is limited.
    for (const code of ['BBBB-BBBB-BBBB', 'CCCC-CCCC-CCCC'])
      expect((await redeem(code)).first).toMatchObject({ code: 'PAIRING_INVALID' });
    expect((await redeem('DDDD-DDDD-DDDD')).first).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('does not accept the shared code', async () => {
    await boot();
    const code = h!.codes.generate();
    expect((await redeem(code)).first).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
  });
});

describe('server mode failed-invite buckets without --public-url', () => {
  const connect = async (ip: string): Promise<TestClient> => {
    const ws = new WebSocket(`ws://127.0.0.1:${h!.port}`, {
      origin: ORIGIN,
      headers: { 'x-forwarded-for': ip },
    });
    await new Promise<void>((res, rej) => {
      ws.once('open', () => res());
      ws.once('error', rej);
    });
    const c = new TestClient(ws);
    clients.push(c);
    return c;
  };
  it('limits one client key and still redeems for another', async () => {
    await boot({ trustProxy: true });
    const good = invite();
    const attempt = async (ip: string, code: string) => {
      const c = await connect(ip);
      c.send(hello({ kind: 'pairingCode', code }));
      return c.next();
    };
    for (let i = 0; i < MAX_FAILED_CODE_ATTEMPTS_PER_CLIENT; i++)
      expect(await attempt('203.0.113.9', 'ZZZZ-ZZZZ-ZZZZ')).toMatchObject({
        code: 'PAIRING_INVALID',
      });
    expect(await attempt('203.0.113.9', 'ZZZZ-ZZZZ-ZZZZ')).toMatchObject({ code: 'RATE_LIMITED' });
    // The limited key cannot spend a valid invite either.
    expect(await attempt('203.0.113.9', good.code)).toMatchObject({ code: 'RATE_LIMITED' });
    expect(await attempt('203.0.113.10', good.code)).toMatchObject({ type: 'welcome' });
  });
});

describe('atomicity', () => {
  it('two sockets presenting one invite in the same tick: exactly one wins', async () => {
    await boot();
    const inv = invite();
    const a = await TestClient.connect(h!.port, ORIGIN);
    const b = await TestClient.connect(h!.port, ORIGIN);
    clients.push(a, b);
    a.send(hello({ kind: 'pairingCode', code: inv.code }));
    b.send(hello({ kind: 'pairingCode', code: inv.code }));
    const results = [await a.next(), await b.next()];
    expect(results.filter((r) => r.type === 'welcome')).toHaveLength(1);
    expect(results.filter((r) => r.type === 'reject')).toMatchObject([{ code: 'PAIRING_INVALID' }]);
    expect(h!.store.listPairings()).toHaveLength(1);
  });

  it('a socket that is not open at the redeem leaves the invite unused and creates no row', async () => {
    await boot();
    const inv = invite();
    const desc = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'readyState')!;
    let closing = true;
    Object.defineProperty(WebSocket.prototype, 'readyState', {
      configurable: true,
      get(this: { _isServer: boolean }) {
        return closing && this._isServer ? 2 : desc.get!.call(this);
      },
    });
    try {
      const c = await TestClient.connect(h!.port, ORIGIN);
      clients.push(c);
      c.send(hello({ kind: 'pairingCode', code: inv.code }));
      await new Promise((r) => setTimeout(r, 150));
      expect(c.messages).toEqual([]);
    } finally {
      closing = false;
      Object.defineProperty(WebSocket.prototype, 'readyState', desc);
    }
    expect(h!.store.invites.findByHash(hashInviteCode(inv.code))).toMatchObject({
      usedAt: null,
      result: null,
    });
    expect(h!.store.listPairings()).toEqual([]);
    expect((await redeem(inv.code)).first).toMatchObject({ type: 'welcome' });
  });
});

describe('local mode', () => {
  it('uses the shared code and refuses a database invite', async () => {
    h = await startServer({ now });
    const inv = invite();
    expect((await redeem(inv.code)).first).toMatchObject({ type: 'reject' });
    expect(h.store.invites.findByHash(hashInviteCode(inv.code))).toMatchObject({ usedAt: null });
    expect((await redeem(h.codes.generate())).first).toMatchObject({ type: 'welcome' });
  });
});

describe('in-memory invite provider', () => {
  const provider = (): MemoryInviteProvider & { used: Set<string> } => {
    const used = new Set<string>();
    return {
      used,
      redeem(code, claim) {
        if (code !== 'MEM1-MEM1-MEM1' || used.has(code)) return 'unknown';
        used.add(code);
        return claim.worldId === 'w1' && claim.userId === 'agent' && claim.origin === ORIGIN
          ? 'match'
          : 'mismatch';
      },
    };
  };

  it('pairs a matching hello in server mode', async () => {
    await boot({ inviteProvider: provider() });
    const r = await redeem('MEM1-MEM1-MEM1', { userId: 'agent' });
    expect(r.first).toMatchObject({ type: 'welcome' });
    expect(h!.store.listActivePairings()).toMatchObject([{ userId: 'agent', origin: ORIGIN }]);
  });

  it('refuses another user and spends the invite', async () => {
    await boot({ inviteProvider: provider() });
    expect((await redeem('MEM1-MEM1-MEM1', { userId: 'other' })).first).toMatchObject({
      code: 'PAIRING_INVALID',
    });
    expect((await redeem('MEM1-MEM1-MEM1', { userId: 'agent' })).first).toMatchObject({
      code: 'PAIRING_INVALID',
    });
  });

  it('refuses another origin', async () => {
    await boot({ inviteProvider: provider(), allowedOrigins: undefined });
    expect(
      (await redeem('MEM1-MEM1-MEM1', { userId: 'agent', origin: 'https://other.example' })).first,
    ).toMatchObject({ code: 'PAIRING_INVALID' });
  });

  it('also works in local mode, before the shared code', async () => {
    h = await startServer({ now, inviteProvider: provider() });
    expect((await redeem('MEM1-MEM1-MEM1', { userId: 'agent' })).first).toMatchObject({
      type: 'welcome',
    });
    expect((await redeem(h.codes.generate())).first).toMatchObject({ type: 'welcome' });
  });
});

describe('logging', () => {
  it('names the hello ids through safeText: no control characters reach the log', async () => {
    const seen: string[] = [];
    await boot({
      onOriginRejected: (_o: string | undefined, r: OriginRejection, d?: string) =>
        void seen.push(`${r} ${d ?? ''}`),
    });
    await redeem('AAAA-AAAA-AAAA', { userId: 'u\x1b[31m\nx', worldId: 'w\x1b[0m' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('no valid invite');
    expect(seen[0]).not.toMatch(/[\x00-\x1f]/);
  });

  it('stores the name without control characters', async () => {
    await boot();
    const inv = invite();
    const c = await TestClient.connect(h!.port, ORIGIN);
    clients.push(c);
    const m = hello({ kind: 'pairingCode', code: inv.code }) as { user: { name: string } };
    m.user.name = 'Al\x1b[31m\nice';
    c.send(m);
    expect(await c.next()).toMatchObject({ type: 'welcome' });
    const name = h!.store.listActivePairings()[0]!.userName;
    expect(name).toContain('Al');
    expect(name).not.toMatch(/[\x00-\x1f]/);
  });
});
