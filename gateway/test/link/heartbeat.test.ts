import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_INTERVAL_MS } from '../../src/link/index.js';
import { TestClient, hello, startServer, type Harness } from './helpers.js';

let h: Harness;
beforeEach(async () => {
  h = await startServer();
});
afterEach(async () => {
  vi.useRealTimers();
  await h.server.close();
  h.store.close();
});

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setImmediate(r));
}

describe('heartbeat', () => {
  it('pings every 15 s and drops the link after two missed pongs', async () => {
    const c = await TestClient.connect(h.port);
    c.send(hello({ kind: 'pairingCode', code: h.codes.generate() }));
    await c.next('welcome');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    // Interval was created on real timers; recreate by reconnecting under fake timers.
    c.ws.terminate();
    const c2 = await TestClient.connect(h.port);
    c2.send(hello({ kind: 'pairingCode', code: h.codes.generate() }));
    await c2.next('welcome');

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect((await c2.next('ping')).type).toBe('ping');
    c2.send({ type: 'pong' });
    await until(() => false);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    await c2.next('ping');
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    await c2.next('ping');
    expect(h.registry.get('w1', 'u1')).toBeDefined();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    await c2.untilClosed();
    await until(() => h.registry.get('w1', 'u1') === undefined);
    expect(h.registry.get('w1', 'u1')).toBeUndefined();
  });
});
