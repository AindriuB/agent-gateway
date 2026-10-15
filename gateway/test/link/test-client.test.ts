import { afterEach, describe, expect, it } from 'vitest';
import { pairModule } from '../routing/harness.js';
import { ORIGIN, TestClient, hello, startServer, type Harness } from './helpers.js';

const within = async <T>(p: Promise<T>, ms = 1000): Promise<T> => {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => {
        t = setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(t);
  }
};

describe('TestClient fail-fast on a lost pairing race', () => {
  let h: Harness | undefined;
  const clients: TestClient[] = [];
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.ws.terminate());
    await h?.server.close();
    h?.store.close();
    h = undefined;
  });

  it('rejects the loser of a same-code race naming the close and the reject', async () => {
    h = await startServer();
    const code = h.codes.generate();
    const a = await TestClient.connect(h.port, ORIGIN);
    const b = await TestClient.connect(h.port, ORIGIN);
    clients.push(a, b);
    a.send(hello({ kind: 'pairingCode', code }, { userId: 'a' }));
    await a.next('welcome');
    b.send(hello({ kind: 'pairingCode', code }, { userId: 'b' }));
    const err = await within(
      b.next('welcome').then(
        () => null,
        (e: Error) => e,
      ),
    );
    expect(err?.message).toMatch(/closed/);
    expect(err?.message).toMatch(/reject/);
  });

  it('pairModule throws on a spent code', async () => {
    h = await startServer();
    const code = h.codes.generate();
    const a = await TestClient.connect(h.port, ORIGIN);
    clients.push(a);
    a.send(hello({ kind: 'pairingCode', code }, { userId: 'a' }));
    await a.next('welcome');
    const real = h.codes.generate.bind(h.codes);
    h.codes.generate = () => code;
    try {
      await expect(within(pairModule(h, 'late'))).rejects.toThrow(
        'pairing rejected: PAIRING_INVALID',
      );
    } finally {
      h.codes.generate = real;
    }
  });

  it('next() with no type still returns a buffered reject after close', async () => {
    h = await startServer();
    const c = await TestClient.connect(h.port, ORIGIN);
    clients.push(c);
    c.send(hello({ kind: 'pairingCode', code: 'nope' }));
    await c.untilClosed();
    expect((await c.next()).type).toBe('reject');
    await expect(c.next()).rejects.toThrow(/closed/);
  });
});
