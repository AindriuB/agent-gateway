import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { until } from '../routing/harness.js';
import { TestClient, hello, startServer, type Harness } from './helpers.js';

let h: Harness;
beforeEach(async () => {
  h = await startServer();
});
afterEach(async () => {
  await h.server.close();
  h.store.close();
});

describe('a call in flight when the link drops', () => {
  it('fails with WORLD_OFFLINE and tells the agent it may retry the same call', async () => {
    const c = await TestClient.connect(h.port);
    c.send(hello({ kind: 'pairingCode', code: h.codes.generate() }));
    await c.next('welcome');
    const conn = h.registry.get('w1', 'u1')!;
    const call = h.registry.call(conn, 'write_thing', { id: 'x' }, 5000);
    const failed = call.catch((e: unknown) => e);
    await c.next('call');
    c.ws.terminate();
    const err = (await failed) as { code: string; message: string };
    expect(err.code).toBe('WORLD_OFFLINE');
    expect(err.message).toContain('retry the same call');
    expect(err.message).toContain('pending approval');
    await until(() => h.registry.get('w1', 'u1') === undefined);
  });
});
