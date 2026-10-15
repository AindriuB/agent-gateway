import { afterEach, describe, expect, it } from 'vitest';
import { HeadlessInvites } from '../../src/headless/invites.js';
import { ORIGIN, TestClient, hello, startServer, type Harness } from './helpers.js';

const W = 'w1';
const AGENT = 'u-agent';
const AGENT2 = 'u-agent2';

let h: Harness | undefined;
const clients: TestClient[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  await h?.server.close();
  h?.store.close();
  h = undefined;
});

const agents = new Map<string, string | undefined>([
  [AGENT, 'owner1'],
  [AGENT2, undefined],
]);
const invites = new HeadlessInvites({ isAgentActive: (w, u) => w === W && agents.has(u) });

async function boot() {
  h = await startServer({
    inviteProvider: invites,
    isHeadlessAgent: (w, u) => w === W && agents.has(u),
    headlessOwner: (w, u) => (w === W ? agents.get(u) : undefined),
  });
}

async function welcomeOf(userId: string, code: string, claimHeadless = false) {
  const c = await TestClient.connect(h!.port, ORIGIN);
  clients.push(c);
  const base = hello({ kind: 'pairingCode', code }, { worldId: W, userId });
  c.send(claimHeadless ? { ...base, headless: true } : base);
  return c.next();
}

describe('welcome for a headless-classified connection', () => {
  it('carries headless and the configured owner', async () => {
    await boot();
    const code = invites.mint(W, AGENT, ORIGIN)!;
    expect(await welcomeOf(AGENT, code, true)).toMatchObject({
      type: 'welcome',
      headless: true,
      ownerUserId: 'owner1',
    });
  });

  it('carries headless but no owner for an agent without one', async () => {
    await boot();
    const code = invites.mint(W, AGENT2, ORIGIN)!;
    const w = (await welcomeOf(AGENT2, code)) as Record<string, unknown>;
    expect(w.type).toBe('welcome');
    expect(w.headless).toBe(true);
    expect('ownerUserId' in w).toBe(false);
  });

  it('carries neither field for a browser user, even one that claimed headless', async () => {
    await boot();
    const w = (await welcomeOf('u-human', h!.codes.generate(), true)) as Record<string, unknown>;
    expect(w.type).toBe('welcome');
    expect('headless' in w).toBe(false);
    expect('ownerUserId' in w).toBe(false);
  });
});
