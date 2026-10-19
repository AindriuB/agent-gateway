import { afterEach, describe, expect, it } from 'vitest';
import type { LinkMessage } from '@agent-gateway/protocol';
import { createInvite } from '../../src/link/invites.js';
import { ORIGIN, TestClient, hello, startServer, type Harness } from './helpers.js';

let h: Harness | undefined;
const clients: TestClient[] = [];
const clock = 1_000_000;
const now = () => clock;

afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  await h?.server.close();
  h?.store.close();
  h = undefined;
});

async function connect(): Promise<TestClient> {
  const c = await TestClient.connect(h!.port, ORIGIN);
  clients.push(c);
  return c;
}

async function admin(protocolVersion?: string): Promise<TestClient> {
  const { code } = createInvite(h!.store, { worldId: 'w1', userId: 'gm1', admin: true }, clock);
  const c = await connect();
  c.send(hello({ kind: 'pairingCode', code }, { worldId: 'w1', userId: 'gm1', protocolVersion }));
  expect(await c.next()).toMatchObject({ type: 'welcome', admin: true });
  return c;
}

/** A player redeems a plain invite and is challenged; returns its socket and the nonce. */
async function challenged(): Promise<{ p: TestClient; nonce: string; first: LinkMessage }> {
  const { code } = createInvite(h!.store, { worldId: 'w1', userId: 'p1' }, clock);
  const p = await connect();
  p.send(hello({ kind: 'pairingCode', code }, { userId: 'p1', isGM: false }));
  const first = await p.next();
  expect(first).toMatchObject({ type: 'pairingChallenge' });
  return { p, nonce: (first as { nonce: string }).nonce, first };
}

async function flush(c: TestClient): Promise<void> {
  c.send({ type: 'ping' });
  await c.next('pong');
}

const attest = (c: TestClient, nonce: string, authorId: string, authorIsGM = false): void =>
  c.send({ type: 'attest', nonce, authorId, authorIsGM });

describe('attestResult', () => {
  it('a 7.3 admin gets exactly one paired for a valid attest', async () => {
    h = await startServer({ serverMode: true, now });
    const a = await admin();
    const { p, nonce } = await challenged();
    attest(a, nonce, 'p1');
    expect(await a.next()).toEqual({ type: 'attestResult', nonce, outcome: 'paired' });
    expect(await p.next()).toMatchObject({ type: 'welcome' });
    await flush(a);
  });

  it('an author mismatch and a GM author each get refused', async () => {
    h = await startServer({ serverMode: true, now });
    const a = await admin();
    const one = await challenged();
    attest(a, one.nonce, 'someone-else');
    expect(await a.next()).toEqual({ type: 'attestResult', nonce: one.nonce, outcome: 'refused' });
    const two = await challenged();
    attest(a, two.nonce, 'p1', true);
    expect(await a.next()).toEqual({ type: 'attestResult', nonce: two.nonce, outcome: 'refused' });
  });

  it('an unknown nonce gets no frame', async () => {
    h = await startServer({ serverMode: true, now });
    const a = await admin();
    attest(a, 'no-such-nonce', 'p1');
    await flush(a);
  });

  it('a 7.2 admin gets no attestResult in any case, and pairing still completes', async () => {
    h = await startServer({ serverMode: true, now });
    const a = await admin('7.2.0');
    const ok = await challenged();
    attest(a, ok.nonce, 'p1');
    expect(await ok.p.next()).toMatchObject({ type: 'welcome' });
    const bad = await challenged();
    attest(a, bad.nonce, 'other');
    const gm = await challenged();
    attest(a, gm.nonce, 'p1', true);
    attest(a, 'unknown', 'p1');
    // next('pong') skips nothing silently if an attestResult were queued first.
    a.send({ type: 'ping' });
    expect(await a.next()).toMatchObject({ type: 'pong' });
  });
});
