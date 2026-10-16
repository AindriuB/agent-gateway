import { afterEach, expect, it } from 'vitest';
import { pairModule } from '../routing/harness.js';
import { startServer, type Harness } from './helpers.js';

let h: Harness;
afterEach(async () => {
  await h?.server.close();
  h?.store.close();
});

it('settles a call with the images from the result frame', async () => {
  h = await startServer();
  const m = await pairModule(h, 'u1');
  const conn = h.registry.get('w1', 'u1')!;
  const pending = conn.call('t', {}, 2000);
  const c = (await m.tc.next('call')) as { id: string };
  const images = [{ mimeType: 'image/png', data: 'iVBORw0KGgo=' }];
  m.tc.send({ type: 'result', id: c.id, ok: true, text: 'x', images });
  expect(await pending).toEqual({ text: 'x', images });
  const p2 = conn.call('t', {}, 2000);
  const c2 = (await m.tc.next('call')) as { id: string };
  m.tc.send({ type: 'result', id: c2.id, ok: true, text: 'y' });
  expect(await p2).toEqual({ text: 'y' });
  m.tc.ws.terminate();
});
