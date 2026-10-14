import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type Harness } from '../link/helpers.js';
import {
  expectErrorCode,
  openSession,
  pairModule,
  tick,
  type FakeModule,
  type McpSession,
} from './harness.js';

let h: Harness | undefined;
const sessions: McpSession[] = [];
const modules: FakeModule[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
  modules.splice(0).forEach((m) => m.tc.ws.terminate());
  await h?.server.close();
  h?.store.close();
  h = undefined;
});

const call = (s: McpSession) => s.client.callTool({ name: 'fixture_tool', arguments: { a: 'x' } });

describe('exactId selector', () => {
  it('does not match a user whose recorded name equals the selector user id', async () => {
    h = await startServer();
    // The user with id uB has chosen the display name "uA", the id of someone else.
    const imposter = await pairModule(h, 'uB', { userName: 'uA' });
    modules.push(imposter);
    const s = await openSession(h, { world: 'w1', user: 'uA', exactId: true });
    sessions.push(s);
    expectErrorCode((await call(s)) as Record<string, unknown>, 'WORLD_OFFLINE');
    await tick();
    expect(imposter.tc.messages.filter((m) => m.type === 'call')).toEqual([]);
  });

  it('without exactId the name still matches (existing behaviour)', async () => {
    h = await startServer();
    const imposter = await pairModule(h, 'uB', { userName: 'uA' });
    modules.push(imposter);
    const s = await openSession(h, { world: 'w1', user: 'uA' });
    sessions.push(s);
    const pending = call(s);
    const frame = await imposter.tc.next('call');
    expect(frame.type).toBe('call');
    void pending.catch(() => undefined);
  });
});
