import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../link/helpers.js';
import { fixtureTool, openSession, pairModule, type McpSession } from '../routing/harness.js';
import type { Harness } from '../link/helpers.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
let h: Harness;
const sessions: McpSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
  await h?.server.close();
  h?.store.close();
});

async function run(frame: Record<string, unknown>, list = true) {
  h = await startServer();
  const m = await pairModule(h, 'u1');
  const s = await openSession(h, {}, [fixtureTool]);
  sessions.push(s);
  if (list) await s.client.listTools();
  const pending = s.client.callTool({ name: 'fixture_tool', arguments: { a: 'x' } });
  const call = (await m.tc.next('call')) as { id: string };
  m.tc.send({ type: 'result', id: call.id, ok: true, text: 'seen', ...frame });
  return pending;
}

describe('MCP image results', () => {
  it('returns text then image with the unchanged structuredContent', async () => {
    const data = PNG.toString('base64');
    const res = await run({ structured: { b: 'y' }, images: [{ mimeType: 'image/png', data }] });
    expect(res.content).toEqual([
      { type: 'text', text: 'seen' },
      { type: 'image', data, mimeType: 'image/png' },
    ]);
    expect(res.structuredContent).toEqual({ b: 'y' });
    expect(JSON.stringify(res.structuredContent)).not.toContain(data);
  });

  it('has no structuredContent key when the module sent no structured', async () => {
    const data = PNG.toString('base64');
    // No listTools first: the SDK client rejects such a result for a tool with an outputSchema.
    const res = await run({ images: [{ mimeType: 'image/png', data }] }, false);
    expect(res.content).toEqual([
      { type: 'text', text: 'seen' },
      { type: 'image', data, mimeType: 'image/png' },
    ]);
    expect('structuredContent' in res).toBe(false);
  });

  it.each([
    ['a mismatched magic number', 'image/jpeg', PNG],
    ['SVG bytes labelled image/png', 'image/png', SVG],
  ])('fails INTERNAL with no image for %s', async (_n, mimeType, bytes) => {
    const res = await run({
      structured: { b: 'y' },
      images: [{ mimeType, data: bytes.toString('base64') }],
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res)).toContain('INTERNAL');
    expect(JSON.stringify(res)).not.toContain('"image"');
  });

  it('leaves results without images unchanged', async () => {
    const res = await run({ structured: { b: 'y' } });
    expect(res.content).toEqual([{ type: 'text', text: 'seen' }]);
    expect(res.structuredContent).toEqual({ b: 'y' });
  });
});
