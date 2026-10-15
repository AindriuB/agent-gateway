import { afterEach, describe, expect, it } from 'vitest';
import { HeadlessInvites } from '../../src/headless/invites.js';
import { createInvite } from '../../src/link/invites.js';
import { ORIGIN, TestClient, hello, startServer, type Harness } from './helpers.js';

const W = 'w1';
const AGENT = 'u-agent';

let h: Harness | undefined;
const clients: TestClient[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  await h?.server.close();
  h?.store.close();
  h = undefined;
});

let active = true;
let clock = 1_000_000;
const invites = () =>
  new HeadlessInvites({
    isAgentActive: (w, u) => active && w === W && u === AGENT,
    now: () => clock,
  });

interface Boot {
  invites: HeadlessInvites;
  rejected: string[];
  logs: string[];
}
async function boot(
  serverMode: boolean,
  over: Parameters<typeof startServer>[0] = {},
): Promise<Boot> {
  active = true;
  clock = 1_000_000;
  const inv = invites();
  const rejected: string[] = [];
  const logs: string[] = [];
  h = await startServer({
    serverMode,
    now: () => clock,
    inviteProvider: inv,
    isHeadlessAgent: (w, u) => w === W && u === AGENT,
    log: (l) => void logs.push(l),
    onOriginRejected: (_o, r, d) => void rejected.push(`${r} ${d ?? ''}`),
    ...over,
  });
  return { invites: inv, rejected, logs };
}

async function say(
  code: string,
  who: { userId?: string; origin?: string; headless?: boolean } = {},
) {
  const c = await TestClient.connect(h!.port, who.origin ?? ORIGIN);
  clients.push(c);
  const base = hello({ kind: 'pairingCode', code }, { worldId: W, userId: who.userId ?? AGENT });
  c.send(who.headless ? { ...base, headless: true } : base);
  return { c, first: await c.next() };
}

describe.each([true, false])('minted invites, server mode %s', (serverMode) => {
  it('pairs the agent from the configured origin and classifies it headless', async () => {
    const b = await boot(serverMode);
    const code = b.invites.mint(W, AGENT, ORIGIN)!;
    const r = await say(code, { headless: true });
    expect(r.first).toMatchObject({ type: 'welcome' });
    expect(h!.registry.get(W, AGENT)?.info.headless).toBe(true);
    expect(b.logs).toEqual([]);
  });

  it('refuses another user and spends the invite', async () => {
    const b = await boot(serverMode);
    const code = b.invites.mint(W, AGENT, ORIGIN)!;
    expect((await say(code, { userId: 'u-gm' })).first).toMatchObject({ code: 'PAIRING_INVALID' });
    expect((await say(code)).first).toMatchObject({ code: 'PAIRING_INVALID' });
    expect(h!.store.listActivePairings()).toEqual([]);
  });

  it('refuses another origin and spends the invite', async () => {
    const b = await boot(serverMode, { allowedOrigins: undefined });
    const code = b.invites.mint(W, AGENT, ORIGIN)!;
    expect((await say(code, { origin: 'http://evil.example' })).first).toMatchObject({
      code: 'PAIRING_INVALID',
    });
    expect((await say(code)).first).toMatchObject({ code: 'PAIRING_INVALID' });
  });

  it('refuses an expired invite', async () => {
    const b = await boot(serverMode);
    const code = b.invites.mint(W, AGENT, ORIGIN)!;
    clock += 2 * 60_000 + 1;
    expect((await say(code)).first).toMatchObject({ code: 'PAIRING_INVALID' });
  });

  it('refuses at redeem time when the agent stopped being active, and creates no row', async () => {
    const b = await boot(serverMode);
    const code = b.invites.mint(W, AGENT, ORIGIN)!;
    active = false;
    expect((await say(code)).first).toMatchObject({ code: 'PAIRING_INVALID' });
    expect(h!.store.listActivePairings()).toEqual([]);
    expect(b.invites.mint(W, AGENT, ORIGIN)).toBeUndefined();
  });

  it('refuses a hello for the agent that carries a code that is not a live invite', async () => {
    const b = await boot(serverMode);
    const shared = h!.codes.generate();
    const r = await say(shared);
    expect(r.first).toMatchObject({ code: 'PAIRING_INVALID' });
    expect(b.rejected.some((x) => x.includes('pairs only through the runner'))).toBe(true);
    // The shared code was not consumed: a human pairs with it (local mode only).
    if (!serverMode)
      expect((await say(shared, { userId: 'u-human' })).first).toMatchObject({ type: 'welcome' });
  });
});

describe('the agent user is not for humans', () => {
  it('refuses an operator database invite for the agent and leaves it unspent', async () => {
    const b = await boot(true);
    const { code } = createInvite(h!.store, { worldId: W, userId: AGENT, gm: true }, clock);
    expect((await say(code)).first).toMatchObject({ code: 'PAIRING_INVALID' });
    expect(b.rejected.join('\n')).toContain('headless agent');
    expect(h!.store.invites.countUnusedForWorld(W, clock)).toBe(1);
  });

  it('lets a human pair another user with the local code', async () => {
    await boot(false);
    expect((await say(h!.codes.generate(), { userId: 'u-human' })).first).toMatchObject({
      type: 'welcome',
    });
  });
});

describe('classification comes from the gateway, not from hello.headless', () => {
  it('logs one line and ignores a headless claim by another user', async () => {
    const b = await boot(false);
    const r = await say(h!.codes.generate(), { userId: 'u-other', headless: true });
    expect(r.first).toMatchObject({ type: 'welcome' });
    expect(h!.registry.get(W, 'u-other')?.info.headless).toBe(false);
    expect(b.logs).toHaveLength(1);
    expect(b.logs[0]).toContain('claimed to be headless');
  });

  it('classifies the agent headless even when its hello does not say so', async () => {
    const b = await boot(false);
    const code = b.invites.mint(W, AGENT, ORIGIN)!;
    await say(code);
    expect(h!.registry.get(W, AGENT)?.info.headless).toBe(true);
    expect(b.logs).toEqual([]);
  });
});

describe('a closed slot', () => {
  it('reports when a newer connection replaced the agent', async () => {
    const replaced: string[] = [];
    const b = await boot(false, {
      onReplaced: (w, u, n) => void replaced.push(`${w}/${u}/${n}`),
    });
    const first = await say(b.invites.mint(W, AGENT, ORIGIN)!);
    expect(first.first).toMatchObject({ type: 'welcome' });
    await say(b.invites.mint(W, AGENT, ORIGIN)!);
    await first.c.untilClosed();
    for (let i = 0; i < 100 && replaced.length === 0; i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(replaced).toEqual([`${W}/${AGENT}/U`]);
  });
});
