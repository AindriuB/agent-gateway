import { afterEach, describe, expect, it } from 'vitest';
import {
  CODE_ATTEMPT_WINDOW_MS,
  CodeAttempts,
  MAX_FAILED_CODE_ATTEMPTS,
  MAX_PENDING_HANDSHAKES,
  PairingCodes,
} from '../../src/link/index.js';
import { TestClient, hello, startServer, type Harness } from './helpers.js';

let h: Harness | undefined;
const clients: TestClient[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  await h?.server.close();
  h?.store.close();
  h = undefined;
});
async function helloOnce(auth: Parameters<typeof hello>[0]) {
  const c = await TestClient.connect(h!.port);
  clients.push(c);
  c.send(hello(auth));
  return c.next();
}

describe('failed pairing code limit', () => {
  it('refuses even a valid code after 10 failures in a minute, then allows it after the window', async () => {
    let t = 1_000_000;
    const codes = new PairingCodes(() => t);
    h = await startServer({ codes, now: () => t });
    const valid = codes.generate();
    for (let i = 0; i < MAX_FAILED_CODE_ATTEMPTS; i++) {
      expect(await helloOnce({ kind: 'pairingCode', code: 'AAAA-AAAA' })).toMatchObject({
        code: 'PAIRING_INVALID',
      });
      t += 1000;
    }
    expect(await helloOnce({ kind: 'pairingCode', code: valid })).toMatchObject({
      type: 'reject',
      code: 'RATE_LIMITED',
    });
    t += CODE_ATTEMPT_WINDOW_MS;
    expect(await helloOnce({ kind: 'pairingCode', code: valid })).toMatchObject({
      type: 'welcome',
    });
  });

  it('never counts token hellos', async () => {
    h = await startServer();
    for (let i = 0; i < MAX_FAILED_CODE_ATTEMPTS + 5; i++) {
      expect(await helloOnce({ kind: 'pairingToken', token: `nope${i}` })).toMatchObject({
        code: 'PAIRING_INVALID',
      });
    }
    expect(await helloOnce({ kind: 'pairingCode', code: h.codes.generate() })).toMatchObject({
      type: 'welcome',
    });
  });

  it('slides the window and stays bounded', () => {
    let t = 0;
    const a = new CodeAttempts(() => t);
    for (let i = 0; i < 100; i++) a.recordFailure();
    expect(a.limited()).toBe(true);
    expect((a as unknown as { failures: number[] }).failures).toHaveLength(
      MAX_FAILED_CODE_ATTEMPTS,
    );
    t = CODE_ATTEMPT_WINDOW_MS;
    expect(a.limited()).toBe(false);
  });
});

describe('pre-hello socket cap', () => {
  it('answers 503 to the 17th socket that has not sent hello, and frees a slot on close', async () => {
    h = await startServer({ helloTimeoutMs: 60_000 });
    const idle: TestClient[] = [];
    for (let i = 0; i < MAX_PENDING_HANDSHAKES; i++) {
      const c = await TestClient.connect(h.port);
      clients.push(c);
      idle.push(c);
    }
    await expect(TestClient.connect(h.port)).rejects.toThrow(/503/);
    idle[0]!.ws.close();
    await idle[0]!.untilClosed();
    await new Promise((r) => setTimeout(r, 50));
    clients.push(await TestClient.connect(h.port));
  });

  it('frees the slot once hello arrives', async () => {
    h = await startServer({ helloTimeoutMs: 60_000 });
    for (let i = 0; i < MAX_PENDING_HANDSHAKES - 1; i++)
      clients.push(await TestClient.connect(h.port));
    const c = await TestClient.connect(h.port);
    clients.push(c);
    c.send(hello({ kind: 'pairingCode', code: h.codes.generate() }));
    await c.next('welcome');
    clients.push(await TestClient.connect(h.port));
  });
});
