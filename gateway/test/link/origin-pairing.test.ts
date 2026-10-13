import { afterEach, describe, expect, it } from 'vitest';
import { hashToken } from '../../src/link/index.js';
import { TestClient, hello, startServer, type Harness } from './helpers.js';

const FOUNDRY = 'https://foundry.local';

let h: Harness | undefined;
const clients: TestClient[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  await h?.server.close();
  h?.store.close();
  h = undefined;
});
async function connect(origin: string | null, host?: string): Promise<TestClient> {
  const c = await TestClient.connect(h!.port, origin, host ? { host } : {});
  clients.push(c);
  return c;
}
/** No `allowedOrigins`: any canonical http(s) origin may reach hello. */
const open = async () => {
  h = await startServer({ allowedOrigins: undefined });
  return h;
};
async function pair(origin: string): Promise<string> {
  const c = await connect(origin);
  c.send(hello({ kind: 'pairingCode', code: h!.codes.generate() }));
  const w = await c.next();
  if (w.type !== 'welcome' || !w.pairingToken) throw new Error(`not paired: ${JSON.stringify(w)}`);
  c.ws.close();
  await c.untilClosed();
  return w.pairingToken;
}
async function tokenHello(origin: string, token: string) {
  const c = await connect(origin);
  c.send(hello({ kind: 'pairingToken', token }));
  return c.next();
}

describe('pairings are bound to the origin they were made from', () => {
  it('(a) a code hello from an arbitrary origin pairs and stores that exact origin', async () => {
    await open();
    const c = await connect(FOUNDRY);
    c.send(hello({ kind: 'pairingCode', code: h!.codes.generate() }));
    const w = await c.next();
    expect(w).toMatchObject({ type: 'welcome' });
    const token = (w as { pairingToken?: string }).pairingToken!;
    expect(token).toBeTruthy();
    expect(h!.store.findPairingByHash(hashToken(token))?.origin).toBe(FOUNDRY);
  });

  it('(b) the token reconnects from the same origin', async () => {
    await open();
    const token = await pair(FOUNDRY);
    expect(await tokenHello(FOUNDRY, token)).toMatchObject({ type: 'welcome' });
  });

  it('(c) the token is refused from http of the same host and from another site', async () => {
    await open();
    const token = await pair(FOUNDRY);
    for (const other of ['http://foundry.local', 'https://evil.example']) {
      const r = await tokenHello(other, token);
      expect(r).toMatchObject({
        type: 'reject',
        code: 'PAIRING_INVALID',
        message: 'pairing was made from a different origin',
      });
      expect(JSON.stringify(r)).not.toContain(FOUNDRY);
    }
  });

  it('(c2) a refused replay does not disturb the live connection', async () => {
    await open();
    const token = await pair(FOUNDRY);
    const live = await connect(FOUNDRY);
    live.send(hello({ kind: 'pairingToken', token }));
    expect(await live.next()).toMatchObject({ type: 'welcome' });
    await tokenHello('https://evil.example', token);
    expect(live.closed).toBe(false);
    expect(h!.registry.list()).toHaveLength(1);
  });

  it('(d) an unknown origin without a valid code is refused and creates no pairing', async () => {
    await open();
    const c = await connect('https://evil.example');
    c.send(hello({ kind: 'pairingCode', code: 'AAAA-AAAA' }));
    expect(await c.next()).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
    expect(h!.store.listActivePairings()).toEqual([]);
  });

  it('(e) a pairing with no recorded origin is refused from any origin', async () => {
    await open();
    h!.store.createPairing({
      id: 'old',
      tokenHash: hashToken('legacy'),
      worldId: 'w1',
      userId: 'u1',
    } as never);
    expect(h!.store.findPairingByHash(hashToken('legacy'))?.origin).toBeNull();
    for (const origin of [FOUNDRY, 'http://localhost:30000']) {
      expect(await tokenHello(origin, 'legacy')).toMatchObject({
        type: 'reject',
        code: 'PAIRING_INVALID',
        message: 'pairing predates origin binding; pair again with a code',
      });
    }
  });

  it('(f) unusable Origin headers get a 403 at upgrade', async () => {
    await open();
    for (const origin of [
      null,
      'null',
      'file:///etc/passwd',
      'chrome-extension://abcdefgh',
      'HTTPS://Foundry.Local',
      'https://foundry.local/',
      `https://${'a'.repeat(244)}.com`,
    ]) {
      expect(`https://${'a'.repeat(244)}.com`).toHaveLength(256);
      await expect(TestClient.connect(h!.port, origin)).rejects.toThrow(/403/);
    }
  });

  it('(g) the Host header must be loopback', async () => {
    await open();
    await expect(
      TestClient.connect(h!.port, FOUNDRY, { host: `evil.example:${h!.port}` }),
    ).rejects.toThrow(/403/);
    await expect(
      TestClient.connect(h!.port, FOUNDRY, { host: `localhost:${h!.port + 1}` }),
    ).rejects.toThrow(/403/);
    for (const host of [`localhost:${h!.port}`, `127.0.0.1:${h!.port}`]) {
      const c = await TestClient.connect(h!.port, FOUNDRY, { host });
      clients.push(c);
      expect(c.ws.readyState).toBe(c.ws.OPEN);
    }
  });

  it('(h) --allow-origin restricts upgrade to the listed origins', async () => {
    h = await startServer({ allowedOrigins: [FOUNDRY] });
    const code = h.codes.generate();
    await expect(TestClient.connect(h.port, 'http://localhost:30000')).rejects.toThrow(/403/);
    const c = await connect(FOUNDRY);
    c.send(hello({ kind: 'pairingCode', code }));
    expect(await c.next()).toMatchObject({ type: 'welcome' });
  });

  it('logs token refusals with a token reason while the peer sees the same message', async () => {
    const seen: string[] = [];
    h = await startServer({ allowedOrigins: undefined, onOriginRejected: (_o, r) => seen.push(r) });
    const unknown = await tokenHello(FOUNDRY, 'never-issued');
    const bad = await (async () => {
      const c = await connect(FOUNDRY);
      c.send(hello({ kind: 'pairingCode', code: 'AAAA-AAAA' }));
      return c.next();
    })();
    expect(unknown).toMatchObject({ code: 'PAIRING_INVALID', message: 'no valid pairing code' });
    expect(bad).toMatchObject({ code: 'PAIRING_INVALID', message: 'no valid pairing code' });
    expect(seen).toEqual([
      'pairing token is unknown, revoked, or for another world or user',
      'no valid pairing code',
    ]);
  });

  it('reports each refusal with its origin and reason', async () => {
    const seen: [string | undefined, string][] = [];
    h = await startServer({
      allowedOrigins: undefined,
      onOriginRejected: (o, r) => seen.push([o, r]),
    });
    await expect(TestClient.connect(h.port, 'null')).rejects.toThrow();
    const c = await connect('https://evil.example');
    c.send(hello({ kind: 'pairingCode', code: 'AAAA-AAAA' }));
    await c.next();
    expect(seen).toEqual([
      ['null', 'origin is not an allowed browser origin'],
      ['https://evil.example', 'no valid pairing code'],
    ]);
  });
});
