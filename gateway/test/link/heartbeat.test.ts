import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_INTERVAL_MS, MAX_MISSED_PONGS } from '../../src/link/index.js';
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

async function fakeTimerClient(): Promise<TestClient> {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const c = await TestClient.connect(h.port);
  c.send(hello({ kind: 'pairingCode', code: h.codes.generate() }));
  await c.next('welcome');
  return c;
}

describe('heartbeat', () => {
  it('tolerates a peer that answers no pings for 100 s', async () => {
    const c = await fakeTimerClient();
    for (let t = 0; t < 100_000; t += HEARTBEAT_INTERVAL_MS) {
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      await until(() => false);
    }
    expect(h.registry.get('w1', 'u1')).toBeDefined();
    c.ws.terminate();
  });

  it('closes the link with heartbeat-timeout after 120 to 150 s of silence', async () => {
    expect(MAX_MISSED_PONGS * HEARTBEAT_INTERVAL_MS).toBeGreaterThanOrEqual(120_000);
    expect((MAX_MISSED_PONGS + 1) * HEARTBEAT_INTERVAL_MS).toBeLessThanOrEqual(150_000);
    const events: unknown[] = [];
    await h.server.close();
    h.store.close();
    h = await startServer({ onLinkEvent: (e) => events.push(e) });
    const c = await fakeTimerClient();
    for (let i = 0; i < MAX_MISSED_PONGS; i++) {
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      await until(() => false);
    }
    expect(h.registry.get('w1', 'u1')).toBeDefined();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    await c.untilClosed();
    await until(() => h.registry.get('w1', 'u1') === undefined);
    expect(h.registry.get('w1', 'u1')).toBeUndefined();
    expect(events).toContainEqual(expect.objectContaining({ reason: 'heartbeat-timeout' }));
  });

  it('stays open for 30 simulated minutes while the peer answers pings', async () => {
    const c = await fakeTimerClient();
    for (let t = 0; t < 30 * 60_000; t += HEARTBEAT_INTERVAL_MS) {
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      await c.next('ping');
      c.send({ type: 'pong' });
      await until(() => false);
    }
    expect(h.registry.get('w1', 'u1')).toBeDefined();
    c.ws.terminate();
  });

  it('counts any inbound frame as liveness, not only a pong', async () => {
    const c = await fakeTimerClient();
    // Three rounds of MAX_MISSED_PONGS - 1 silent intervals, each ended by a non-pong frame: far
    // past the bound overall, so the link survives only if that frame counts as liveness.
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < MAX_MISSED_PONGS - 1; i++) {
        vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
        await until(() => false);
      }
      c.send({ type: 'ping' });
      await c.next('pong');
    }
    expect(h.registry.get('w1', 'u1')).toBeDefined();
    c.ws.terminate();
  });
});
