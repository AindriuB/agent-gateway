import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_FRAME_BYTES, TOOLS, toJsonSchema } from '@agent-gateway/protocol';
import { startServer, type Harness } from './helpers.js';
import {
  openSession,
  pairModule,
  until,
  tick,
  type McpSession,
  type FakeModule,
} from '../routing/harness.js';
let h: Harness;
let s: McpSession;
let m: FakeModule;
afterEach(async () => {
  await s?.close();
  m?.tc.ws.terminate();
  await h?.server.close();
  h?.store.close();
  vi.restoreAllMocks();
});
const definition = () => ({
  name: TOOLS[0]!.name,
  description: TOOLS[0]!.description,
  category: TOOLS[0]!.category,
  minRole: TOOLS[0]!.minRole,
  ...toJsonSchema(TOOLS[0]!),
});
async function setup() {
  h = await startServer();
  m = await pairModule(h, 'gm', { isGM: true });
  s = await openSession(h, {}, TOOLS, 5000, { listChangedIntervalMs: 10 });
  await s.client.listTools();
  m.tc.send({ type: 'toolset', tools: [definition()] });
  await until(() => s.listChanged.count === 1);
}
describe('authenticated dynamic toolset caps', () => {
  it.each(['count', 'bytes'])(
    'ignores %s overflow while retaining the connection and listing',
    async (cap) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await setup();
      const previous = (await s.client.listTools()).tools;
      const tools =
        cap === 'count'
          ? Array.from({ length: 65 }, definition)
          : [{ ...definition(), description: 'x'.repeat(300 * 1024) }];
      m.tc.send({ type: 'toolset', tools });
      m.tc.send({ type: 'ping' });
      await m.tc.next('pong');
      expect(m.tc.closed).toBe(false);
      expect((await s.client.listTools()).tools).toEqual(previous);
      expect(warn).toHaveBeenCalledWith('ignored toolset: announcement count or byte cap exceeded');
    },
  );
  it.each([
    { type: 'toolset', tools: 'bad' },
    { type: 'toolset', tools: [{ ...definition(), category: ['read'] }] },
    { type: 'toolset', tools: [{ ...definition(), minRole: ['gm'] }] },
    { type: 'toolset', tools: Array.from({ length: 65 }, () => 'bad') },
    { type: 'toolset', tools: [], extra: true },
  ])('still rejects malformed envelopes', async (message) => {
    await setup();
    m.tc.send(message);
    await until(() => m.tc.closed);
  });
  it('retains the general maximum frame rejection', async () => {
    await setup();
    m.tc.send({
      type: 'toolset',
      tools: [{ ...definition(), description: 'x'.repeat(MAX_FRAME_BYTES) }],
    });
    await until(() => m.tc.closed);
    await tick(10);
    expect(h.registry.list()).toHaveLength(0);
  });
});

describe('hostile toolset depth over the real link', () => {
  it('rejects a pre-authentication 10000-deep frame and still serves a healthy paired core call', async () => {
    h = await startServer();
    const { TestClient } = await import('./helpers.js');
    const attacker = await TestClient.connect(h.port);
    try {
      const raw =
        '{"type":"toolset","tools":[{"name":"world_info","description":"Fixture","category":"read","minRole":"player","inputSchema":' +
        '{"x":'.repeat(10000) +
        '{}' +
        '}'.repeat(10000) +
        ',"outputSchema":{"type":"object","additionalProperties":false}}]}';
      expect(Buffer.byteLength(raw)).toBeLessThan(256 * 1024);
      attacker.ws.send(raw);
      expect(await attacker.next()).toMatchObject({ type: 'reject', code: 'INVALID_ARGS' });
      await attacker.untilClosed();
      m = await pairModule(h, 'healthy', { isGM: true });
      s = await openSession(h, {}, TOOLS);
      const call = s.client.callTool({ name: 'world_info', arguments: {} });
      const frame = await m.tc.next('call');
      expect(frame).toMatchObject({ type: 'call', tool: 'world_info' });
      m.tc.send({ type: 'result', id: (frame as { id: string }).id, ok: true, text: 'healthy' });
      expect((await call).isError).not.toBe(true);
      expect(m.tc.closed).toBe(false);
    } finally {
      attacker.ws.terminate();
    }
  });
  it('does not misclassify excessive depth as a recoverable count-cap failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await setup();
    const deep = JSON.parse('{"x":'.repeat(40) + '{}' + '}'.repeat(40));
    m.tc.send({
      type: 'toolset',
      tools: Array.from({ length: 65 }, () => ({ ...definition(), inputSchema: deep })),
    });
    await until(() => m.tc.closed);
    expect(warn).not.toHaveBeenCalledWith(
      'ignored toolset: announcement count or byte cap exceeded',
    );
  });
});
