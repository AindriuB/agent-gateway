import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_INTERVAL_MS, MAX_MISSED_PONGS } from '../../src/link/index.js';
import type { LinkEvent } from '../../src/link/index.js';
import { until } from '../routing/harness.js';
import { TestClient, hello, startServer, type Harness } from './helpers.js';

let h: Harness | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await h?.server.close();
  h?.store.close();
  h = undefined;
});

async function connect(events: LinkEvent[]): Promise<TestClient> {
  h = await startServer({ onLinkEvent: (e) => events.push(e) });
  const c = await TestClient.connect(h.port);
  c.send(hello({ kind: 'pairingCode', code: h.codes.generate() }));
  await c.next('welcome');
  return c;
}

describe('close cause', () => {
  it('records heartbeat-timeout when pongs stop', async () => {
    const events: LinkEvent[] = [];
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const c = await connect(events);
    for (let i = 0; i <= MAX_MISSED_PONGS; i++) vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    await until(() => events.some((e) => e.kind === 'disconnected'));
    const d = events.find((e) => e.kind === 'disconnected');
    expect(d).toMatchObject({ code: 1006, reason: 'heartbeat-timeout' });
    c.ws.terminate();
  });

  it('records socket-error when the socket errors', async () => {
    const events: LinkEvent[] = [];
    const c = await connect(events);
    // A frame with reserved bits set makes the server-side parser emit 'error'.
    (c.ws as unknown as { _socket: { write(b: Buffer): void } })._socket.write(
      Buffer.from([0xf1, 0x80, 0, 0, 0, 0]),
    );
    await until(() => events.some((e) => e.kind === 'disconnected'));
    const d = events.find((e) => e.kind === 'disconnected');
    expect(d).toMatchObject({ reason: 'socket-error' });
    c.ws.terminate();
  });

  it('keeps the peer code and reason on a peer-initiated close', async () => {
    const events: LinkEvent[] = [];
    const c = await connect(events);
    c.ws.close(4001, 'bye');
    await until(() => events.some((e) => e.kind === 'disconnected'));
    expect(events.find((e) => e.kind === 'disconnected')).toMatchObject({
      code: 4001,
      reason: 'bye',
    });
  });
});
