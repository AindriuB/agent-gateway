import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { CodeAttempts } from '../../src/link/code-attempts.js';
import type { OriginRejection } from '../../src/link/index.js';
import { ORIGIN, TestClient, hello, startServer, type Harness } from './helpers.js';

let h: Harness | undefined;
const clients: TestClient[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  await h?.server.close();
  h?.store.close();
  h = undefined;
});

const PUBLIC = 'https://gw.example.com';

/** Connect with chosen headers; the Host defaults to the public host. */
async function connect(port: number, headers: Record<string, string> = {}): Promise<TestClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
    origin: headers.origin ?? ORIGIN,
    headers: { Host: 'gw.example.com', ...headers },
  });
  await new Promise<void>((res, rej) => {
    ws.once('open', () => res());
    ws.once('error', rej);
  });
  const c = new TestClient(ws);
  clients.push(c);
  return c;
}
const from = (ip: string) => ({ 'x-forwarded-for': ip });

async function wrongCode(port: number, ip: string): Promise<string> {
  const c = await connect(port, from(ip));
  c.send(hello({ kind: 'pairingCode', code: 'ZZZZ-ZZZZ' }));
  const m = (await c.next()) as { code: string };
  return m.code;
}

describe('link Host check with a public URL', () => {
  it('accepts the public host and refuses others even with allowNonLoopback', async () => {
    const seen: OriginRejection[] = [];
    h = await startServer({
      publicUrl: PUBLIC,
      allowNonLoopback: true,
      onOriginRejected: (_o, r) => void seen.push(r),
    });
    const ok = await connect(h.port);
    expect(ok.ws.readyState).toBe(ok.ws.OPEN);
    await expect(connect(h.port, { Host: 'evil.example' })).rejects.toThrow(/403/);
    expect(seen).toContain('host header is not loopback');
  });

  it('checks Host with allowNonLoopback and no public URL: only loopback names pass', async () => {
    h = await startServer({ allowNonLoopback: true });
    await expect(connect(h.port, { Host: 'gw.example.com' })).rejects.toThrow(/403/);
    const c = await connect(h.port, { Host: `localhost:${h.port}` });
    expect(c.ws.readyState).toBe(c.ws.OPEN);
  });
});

describe('public-mode pairing limits', () => {
  it('limits one client key after 5 wrong codes and still pairs another key', async () => {
    h = await startServer({ publicUrl: PUBLIC, trustProxy: true });
    const live = h.codes.generate();
    for (let i = 0; i < 5; i++)
      expect(await wrongCode(h.port, '203.0.113.9')).toBe('PAIRING_INVALID');
    expect(await wrongCode(h.port, '203.0.113.9')).toBe('RATE_LIMITED');
    // The limited key cannot spend the live code, even with the right one.
    const limited = await connect(h.port, from('203.0.113.9'));
    limited.send(hello({ kind: 'pairingCode', code: live }));
    expect(await limited.next()).toMatchObject({ type: 'reject', code: 'RATE_LIMITED' });
    expect(h.codes.current()?.code).toBe(live);
    const other = await connect(h.port, from('203.0.113.10'));
    other.send(hello({ kind: 'pairingCode', code: live }));
    expect(await other.next()).toMatchObject({ type: 'welcome' });
  });

  it('refuses every key once the global backstop is reached', () => {
    let t = 0;
    const a = new CodeAttempts(() => t, { global: 300, perClient: 5 });
    for (let i = 0; i < 300; i++) a.recordFailure(`k${i % 100}.${Math.floor(i / 100)}`);
    expect(a.limited('fresh')).toBe(true);
    t = 61_000;
    expect(a.limited('fresh')).toBe(false);
  });

  it('local mode keeps 10 failures per minute across clients', () => {
    const a = new CodeAttempts(() => 0);
    for (let i = 0; i < 10; i++) a.recordFailure(`k${i}`);
    expect(a.limited('k99')).toBe(true);
  });

  it('keeps the per-client map within its cap', () => {
    const a = new CodeAttempts(() => 0, { global: 1_000_000, perClient: 5 }, 50);
    for (let i = 0; i < 150; i++) {
      a.recordFailure(`k${i}`);
      expect(a.clients).toBeLessThanOrEqual(50);
    }
  });

  it('calls onCodePaired after a code pairing only', async () => {
    let n = 0;
    h = await startServer({ publicUrl: PUBLIC, onCodePaired: () => void n++ });
    const c = await connect(h.port);
    c.send(hello({ kind: 'pairingCode', code: h.codes.generate() }));
    const w = (await c.next('welcome')) as unknown as { pairingToken: string };
    expect(n).toBe(1);
    const c2 = await connect(h.port);
    c2.send(hello({ kind: 'pairingToken', token: w.pairingToken }));
    await c2.next('welcome');
    expect(n).toBe(1);
  });

  it('caps pre-hello sockets per client key, whatever the origin', async () => {
    const origins = Array.from({ length: 6 }, (_, i) => `http://o${i}.test:30000`);
    h = await startServer({ publicUrl: PUBLIC, trustProxy: true, allowedOrigins: origins });
    // Four different origins, so the per-origin cap of 4 is never the rule that fires.
    for (let i = 0; i < 4; i++)
      await connect(h.port, { ...from('203.0.113.9'), origin: origins[i]! });
    await expect(connect(h.port, { ...from('203.0.113.9'), origin: origins[4]! })).rejects.toThrow(
      /503/,
    );
    const other = await connect(h.port, { ...from('203.0.113.10'), origin: origins[5]! });
    expect(other.ws.readyState).toBe(other.ws.OPEN);
  });
});

describe('IPv6 loopback Host in local mode', () => {
  it('accepts [::1] with the bound port and refuses other IPv6 authorities', async () => {
    h = await startServer();
    const c = await connect(h.port, { Host: `[::1]:${h.port}` });
    expect(c.ws.readyState).toBe(c.ws.OPEN);
    await expect(connect(h.port, { Host: '[::2]:' + h.port })).rejects.toThrow(/403/);
    await expect(connect(h.port, { Host: `[::1]:${h.port + 1}` })).rejects.toThrow(/403/);
  });
});

describe('mapped IPv4 loopback Host in local mode', () => {
  it('accepts both spellings with the bound port and refuses others', async () => {
    h = await startServer();
    for (const host of ['[::ffff:127.0.0.1]', '[::ffff:7f00:1]']) {
      const c = await connect(h.port, { Host: `${host}:${h.port}` });
      expect(c.ws.readyState).toBe(c.ws.OPEN);
      await expect(connect(h.port, { Host: `${host}:${h.port + 1}` })).rejects.toThrow(/403/);
    }
    await expect(connect(h.port, { Host: `[::ffff:10.0.0.1]:${h.port}` })).rejects.toThrow(/403/);
    await expect(connect(h.port, { Host: `[::2]:${h.port}` })).rejects.toThrow(/403/);
  });
});
