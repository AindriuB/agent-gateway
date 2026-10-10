import { describe, expect, it, vi } from 'vitest';
import {
  snapshotToolsetValue,
  ToolsetMessage,
  parseLinkMessage,
  MAX_FRAME_BYTES,
} from '../../src/link/index.js';
import { TOOLS, toJsonSchema, TOOL_LIMITS } from '../../src/tools/index.js';
const tool = () => ({
  name: TOOLS[0]!.name,
  description: TOOLS[0]!.description,
  category: TOOLS[0]!.category,
  minRole: TOOLS[0]!.minRole,
  ...toJsonSchema(TOOLS[0]!),
});
const nested = (depth: number) => JSON.parse('{"x":'.repeat(depth) + '{}' + '}'.repeat(depth));
describe('bounded toolset JSON snapshots', () => {
  it('rejects a ten-thousand-deep frame below both byte caps without throwing', () => {
    const raw =
      '{"type":"toolset","tools":[{"name":"world_info","description":"Fixture","category":"read","minRole":"player","inputSchema":' +
      '{"x":'.repeat(10000) +
      '{}' +
      '}'.repeat(10000) +
      ',"outputSchema":{"type":"object","additionalProperties":false}}]}';
    expect(Buffer.byteLength(raw)).toBeLessThan(TOOL_LIMITS.announcementBytes);
    expect(Buffer.byteLength(raw)).toBeLessThan(MAX_FRAME_BYTES);
    expect(() => parseLinkMessage(raw)).not.toThrow();
    expect(parseLinkMessage(raw)).toMatchObject({ ok: false, reason: 'invalid' });
  });
  it('bounds depth and traversal work before serialization and copies valid data', () => {
    expect(snapshotToolsetValue(nested(2000))).toEqual({ ok: false });
    expect(snapshotToolsetValue({ value: 'x'.repeat(TOOL_LIMITS.announcementWork) })).toEqual({
      ok: false,
    });
    const original = { tools: [tool()] };
    const snapshot = snapshotToolsetValue(original);
    expect(snapshot).toEqual({ ok: true, value: original });
    if (snapshot.ok) expect(snapshot.value).not.toBe(original);
    expect(
      ToolsetMessage.safeParse({
        type: 'toolset',
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          category: t.category,
          minRole: t.minRole,
          ...toJsonSchema(t),
        })),
      }).success,
    ).toBe(true);
  });
  it('uses the same depth boundary for full validation and uncapped recovery', () => {
    const within = { ...tool(), inputSchema: nested(30) };
    const over = { ...tool(), inputSchema: nested(31) };
    const uncapped = ToolsetMessage.extend({ tools: ToolsetMessage.shape.tools.element.array() });
    for (const schema of [ToolsetMessage, uncapped]) {
      expect(schema.safeParse({ type: 'toolset', tools: [within] }).success).toBe(true);
      expect(schema.safeParse({ type: 'toolset', tools: [over] }).success).toBe(false);
    }
  });

  it('rejects cycles, accessors, proxy failures and non-JSON values without invoking getters', () => {
    const getter = vi.fn(() => {
      throw new Error('getter');
    });
    const accessor = Object.defineProperty({}, 'value', { get: getter, enumerable: true });
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('proxy');
        },
      },
    );
    for (const value of [
      accessor,
      cycle,
      proxy,
      { toJSON: () => 'hidden' },
      { value: undefined },
      new Date(),
    ])
      expect(snapshotToolsetValue(value)).toEqual({ ok: false });
    expect(getter).not.toHaveBeenCalled();
    expect(() => ToolsetMessage.safeParse({ type: 'toolset', tools: [proxy] })).not.toThrow();
  });
  it('fails closed if serialization unexpectedly throws', () => {
    const value = { type: 'toolset', tools: [tool()] };
    const stringify = vi.spyOn(JSON, 'stringify').mockImplementation(() => {
      throw new RangeError('serializer');
    });
    try {
      expect(ToolsetMessage.safeParse(value).success).toBe(false);
    } finally {
      stringify.mockRestore();
    }
  });
});
