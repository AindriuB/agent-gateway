import { afterEach, describe, expect, it } from 'vitest';
import { imageView } from '@agent-gateway/protocol';
import { startServer } from '../link/helpers.js';
import { fixtureTool, openSession, pairModule, type McpSession } from '../routing/harness.js';
import type { Harness } from '../link/helpers.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
let h: Harness;
const sessions: McpSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
  await h?.server.close();
  h?.store.close();
});

describe('image_view over MCP', () => {
  it('is listed without outputSchema and returns text plus one image, no structuredContent', async () => {
    h = await startServer();
    const m = await pairModule(h, 'u1');
    const s = await openSession(h, {}, [imageView, fixtureTool]);
    sessions.push(s);
    const { tools } = await s.client.listTools();
    const listed = tools.find((t) => t.name === 'image_view')!;
    expect(listed).toBeDefined();
    expect('outputSchema' in listed).toBe(false);
    expect(tools.find((t) => t.name === 'fixture_tool')?.outputSchema).toBeDefined();

    const data = PNG.toString('base64');
    const text = 'Image from file a.png: image/png, 2x2 px, 16 bytes. Not downscaled.';
    const pending = s.client.callTool({
      name: 'image_view',
      arguments: { source: 'file', path: 'a.png' },
    });
    const call = (await m.tc.next('call')) as { id: string };
    m.tc.send({
      type: 'result',
      id: call.id,
      ok: true,
      text,
      images: [{ mimeType: 'image/png', data }],
    });
    const res = await pending;
    expect(res.content).toEqual([
      { type: 'text', text },
      { type: 'image', data, mimeType: 'image/png' },
    ]);
    expect('structuredContent' in res).toBe(false);

    const other = s.client.callTool({ name: 'fixture_tool', arguments: { a: 'x' } });
    const call2 = (await m.tc.next('call')) as { id: string };
    m.tc.send({ type: 'result', id: call2.id, ok: true, text: 'seen', structured: { b: 'y' } });
    expect((await other).structuredContent).toEqual({ b: 'y' });
  });
});
