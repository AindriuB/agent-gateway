import { APPROVAL_WAIT_MS } from '@agent-gateway/protocol/tools';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolsetStore } from '../../src/routing/index.js';
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

    await s.client.listTools();
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
    const immediate = s.client.callTool({ name: 'fixture_tool', arguments: { a: 'hi' } });
    const normalFrame = (await m.tc.next('call')) as { id: string };
    m.tc.send({
      type: 'result',
      id: normalFrame.id,
      ok: true,
      text: 'normal',
      structured: { b: 'normal' },
    });
    expect((await immediate).structuredContent).toEqual({ b: 'normal' });
  });

  it('validates listed read-pack pending, normal, invalid and text-only error responses through the SDK', async () => {
    h = await startServer();
    const m = await pairModule(h, 'uA');
    modules.push(m);
    const toolsets = new ToolsetStore();
    toolsets.set(h.registry.list()[0]!, [
      {
        name: 'demo-read',
        description: 'Read pack fixture',
        category: 'read',
        minRole: 'player',
        pack: { id: 'demo-pack', prefix: 'demo', version: '1.0.0' },
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
          type: 'object',
          properties: { value: { type: 'string', description: 'Normal value' } },
          required: ['value'],
          additionalProperties: false,
        },
      },
    ]);
    const s = await openSession(h, {}, undefined, 5000, { toolsets });
    sessions.push(s);
    const list = await s.client.listTools();
    expect(list.tools.filter((t) => t.name !== 'gateway_status').map((t) => t.name)).toEqual([
      'demo-read',
    ]);
    for (const structured of [{ status: 'pending_approval', id: 'pack-id' }, { value: 'normal' }]) {
      const pending = s.client.callTool({ name: 'demo-read', arguments: {} });
      const frame = (await m.tc.next('call')) as { id: string };
      m.tc.send({ type: 'result', id: frame.id, ok: true, text: 'result', structured });
      expect((await pending).structuredContent).toEqual(structured);
    }
    const invalid = s.client.callTool({ name: 'demo-read', arguments: {} });
    const rejected = expect(invalid).rejects.toThrow('output schema');
    const frame = (await m.tc.next('call')) as { id: string };
    m.tc.send({ type: 'result', id: frame.id, ok: true, text: 'bad', structured: { value: 3 } });
    await rejected;
    const error = s.client.callTool({ name: 'demo-read', arguments: {} });
    const errorFrame = (await m.tc.next('call')) as { id: string };
    m.tc.send({ type: 'error', id: errorFrame.id, code: 'FORBIDDEN', message: 'Denied' });
    const denied = await error;
    expect(denied).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'FORBIDDEN: Denied' }],
    });
    expect(denied.structuredContent).toBeUndefined();
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
