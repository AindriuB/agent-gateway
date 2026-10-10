import { APPROVAL_WAIT_MS } from '@agent-gateway/protocol/tools';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CALL_TIMEOUT_MS } from '../../src/mcp/session.js';
import { startServer, type Harness } from '../link/helpers.js';
import { openSession, pairModule, type FakeModule, type McpSession } from './harness.js';

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

describe('approval wait against the gateway call timeout', () => {
  it('the module waits at least 5 s less than the gateway waits for a call', () => {
    expect(APPROVAL_WAIT_MS).toBeLessThanOrEqual(DEFAULT_CALL_TIMEOUT_MS - 5000);
  });

  it('a module that answers pending after its wait gives the agent pending_approval and the id, not a timeout', async () => {
    h = await startServer();
    const m = await pairModule(h, 'uA', { userName: 'alice' });
    modules.push(m);
    // The same ratio as production, on a shorter clock so the test is quick.
    const timeoutMs = 1200;
    const waitMs = Math.round((timeoutMs * APPROVAL_WAIT_MS) / DEFAULT_CALL_TIMEOUT_MS);
    const s = await openSession(h, {}, undefined, timeoutMs);
    sessions.push(s);

    const pending = s.client.callTool({ name: 'fixture_tool', arguments: { a: 'hi' } });
    const frame = (await m.tc.next('call')) as { id: string };
    await new Promise((r) => setTimeout(r, waitMs));
    m.tc.send({
      type: 'result',
      id: frame.id,
      ok: true,
      text: 'Approval is pending (id abc). Call approval_status with this id.',
      structured: { status: 'pending_approval', id: 'abc' },
    });
    const res = await pending;
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual({ status: 'pending_approval', id: 'abc' });
    expect(JSON.stringify(res.content)).toContain('abc');
  });

  it('a module that waits as long as the gateway does is a timeout (why the margin matters)', async () => {
    h = await startServer();
    const m = await pairModule(h, 'uA', { userName: 'alice' });
    modules.push(m);
    const s = await openSession(h, {}, undefined, 400);
    sessions.push(s);
    const pending = s.client.callTool({ name: 'fixture_tool', arguments: { a: 'hi' } });
    const frame = (await m.tc.next('call')) as { id: string };
    await new Promise((r) => setTimeout(r, 600));
    m.tc.send({ type: 'result', id: frame.id, ok: true, text: 'late', structured: { b: 'x' } });
    const res = await pending;
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).not.toContain('late');
  });
});
