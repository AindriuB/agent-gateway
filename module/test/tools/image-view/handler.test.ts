/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_FRAME_BYTES, ResultMessage } from '@agent-gateway/protocol/link';
import { imageViewHandler, MAX_IMAGE_BYTES } from '../../../src/tools/image-view.js';

afterEach(() => vi.unstubAllGlobals());

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

const gm = { id: 'gm', isGM: true, can: () => true };
const player = { id: 'p', isGM: false, can: () => false };
const trusted = { id: 't', isGM: false, can: (p: string) => p === 'FILES_BROWSE' };

interface Env {
  docs?: Record<string, any>;
  bytes?: Uint8Array;
  chunks?: Uint8Array[];
  dims?: [number, number];
  jpegBytes?: number;
}

function install(user: any, env: Env = {}) {
  const fetchMock = vi.fn(async () => {
    const chunks = env.chunks ?? [env.bytes ?? PNG];
    let i = 0;
    const cancel = vi.fn(async () => {});
    const response = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () =>
            i < chunks.length ? { done: false, value: chunks[i++] } : { done: true },
          cancel,
        }),
      },
    };
    (fetchMock as any).cancel = cancel;
    return response;
  });
  const [w, hgt] = env.dims ?? [100, 50];
  const close = vi.fn();
  const canvases: any[] = [];
  vi.stubGlobal('game', {
    user,
    users: { get: (id: string) => (id === user.id ? user : undefined) },
  });
  vi.stubGlobal('fromUuid', async (u: string) => env.docs?.[u] ?? null);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('foundry', { utils: { getRoute: (p: string) => `/${p}` } });
  vi.stubGlobal('createImageBitmap', async () => ({ width: w, height: hgt, close }));
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        public width: number,
        public height: number,
      ) {
        canvases.push(this);
      }
      getContext() {
        return { fillRect() {}, drawImage() {}, set fillStyle(_v: string) {} };
      }
      async convertToBlob(o: any) {
        expect(o.type).toBe('image/jpeg');
        const b = new Uint8Array(env.jpegBytes ?? 1000);
        b.set([0xff, 0xd8, 0xff]);
        return { arrayBuffer: async () => b.buffer };
      }
    },
  );
  return { fetchMock, canvases, close };
}

const run = (args: any, user: any) =>
  imageViewHandler({ user: { id: user.id, isGM: user.isGM }, args } as any) as Promise<any>;

const doc = (over: any = {}) => ({
  documentName: 'Actor',
  img: 'art/a.png',
  prototypeToken: { texture: { src: 'art/t.png' } },
  testUserPermission: (_u: any, level: string) => level === 'LIMITED' && over.limited === true,
  ...over,
});

describe('image_view handler: results', () => {
  it('returns text and images, no structured key, for a viewable Actor portrait', async () => {
    const { fetchMock } = install(player, { docs: { 'Actor.a': doc({ limited: true }) } });
    const r = await run({ source: 'actor_portrait', uuid: 'Actor.a' }, player);
    expect('structured' in r).toBe(false);
    expect(r.images).toEqual([
      { mimeType: 'image/png', data: Buffer.from(PNG).toString('base64') },
    ]);
    expect(r.text).toContain('actor_portrait');
    expect(r.text).toContain('image/png');
    expect(r.text).toContain('100x50');
    expect(r.text).toContain(`${PNG.length} bytes`);
    expect(r.text).toContain('Not downscaled');
    expect((fetchMock.mock.calls as unknown[][])[0]![0]).toBe('/art/a.png');
  });
  it('reads the prototype token art for actor_token', async () => {
    const { fetchMock } = install(player, { docs: { 'Actor.a': doc({ limited: true }) } });
    await run({ source: 'actor_token', uuid: 'Actor.a' }, player);
    expect((fetchMock.mock.calls as unknown[][])[0]![0]).toBe('/art/t.png');
  });
  it('views a scene background and a token texture', async () => {
    const { fetchMock } = install(gm, {
      docs: {
        'Scene.s': {
          documentName: 'Scene',
          background: { src: 'maps/m.png' },
          testUserPermission: () => true,
        },
        'Scene.s.Token.k': {
          documentName: 'Token',
          texture: { src: 'tok/k.png' },
          parent: { testUserPermission: () => true },
        },
      },
    });
    await run({ source: 'scene_background', uuid: 'Scene.s' }, gm);
    await run({ source: 'token', uuid: 'Scene.s.Token.k' }, gm);
    expect((fetchMock.mock.calls as unknown[][]).map((c) => c[0])).toEqual([
      '/maps/m.png',
      '/tok/k.png',
    ]);
  });
  it('lets a GM or FILES_BROWSE user view a file, with spaces encoded', async () => {
    const { fetchMock } = install(trusted);
    const r = await run({ source: 'file', path: 'my dir/x.png' }, trusted);
    expect(r.images).toHaveLength(1);
    expect(r.text).toContain('file');
    expect((fetchMock.mock.calls as unknown[][])[0]![0]).toBe('/my%20dir/x.png');
  });
});

describe('image_view handler: visibility', () => {
  const refused = async (args: any, user: any, env: Env) => {
    const { fetchMock } = install(user, env);
    const r = await run(args, user);
    expect(r.error?.code).toBe('FORBIDDEN');
    expect(fetchMock).not.toHaveBeenCalled();
  };
  it.each(['actor_portrait', 'actor_token'])('refuses %s without LIMITED', (source) =>
    refused({ source, uuid: 'Actor.a' }, player, { docs: { 'Actor.a': doc({ limited: false }) } }),
  );
  it('refuses a hidden token the user does not own, and a token on an invisible scene', async () => {
    const tok = (hidden: boolean, sceneOk: boolean, isOwner = false) => ({
      documentName: 'Token',
      hidden,
      isOwner,
      texture: { src: 'tok/k.png' },
      parent: { testUserPermission: () => sceneOk },
    });
    await refused({ source: 'token', uuid: 'T' }, player, { docs: { T: tok(true, true) } });
    await refused({ source: 'token', uuid: 'T' }, player, { docs: { T: tok(false, false) } });
  });
  it('allows a hidden token to its owner', async () => {
    install(player, {
      docs: {
        T: {
          documentName: 'Token',
          hidden: true,
          isOwner: true,
          texture: { src: 'a.png' },
          parent: { testUserPermission: () => true },
        },
      },
    });
    expect((await run({ source: 'token', uuid: 'T' }, player)).images).toHaveLength(1);
  });
  it('refuses a scene the user cannot view', () =>
    refused({ source: 'scene_background', uuid: 'S' }, player, {
      docs: {
        S: { documentName: 'Scene', background: { src: 'a.png' }, testUserPermission: () => false },
      },
    }));
  it('refuses a file without FILES_BROWSE', () =>
    refused({ source: 'file', path: 'a.png' }, player, {}));
});

describe('image_view handler: probing', () => {
  it('answers a missing uuid and an unviewable document identically', async () => {
    const { fetchMock } = install(player, {
      docs: {
        'Actor.hidden': doc({ limited: false }),
        'Scene.wrongtype': doc({ documentName: 'Scene', limited: true }),
      },
    });
    const a = await run({ source: 'actor_portrait', uuid: 'Actor.hidden' }, player);
    const b = await run({ source: 'actor_portrait', uuid: 'Actor.missing' }, player);
    const c = await run({ source: 'actor_portrait', uuid: 'Scene.wrongtype' }, player);
    expect(a.error.code).toBe('FORBIDDEN');
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('image_view handler: path and content checks', () => {
  const invalidCase = async (img: string, user = gm) => {
    const { fetchMock } = install(user, { docs: { 'Actor.a': doc({ img }) } });
    const r = await run({ source: 'actor_portrait', uuid: 'Actor.a' }, user);
    expect(r.error?.code).toBe('INVALID_ARGS');
    expect(fetchMock).not.toHaveBeenCalled();
  };
  it('refuses an svg Actor image without fetching', () => invalidCase('icons/svg/mystery.svg'));
  it('refuses an external URL Actor image without fetching', () =>
    invalidCase('https://example.com/a.png'));
  it('refuses a traversal file path without fetching', async () => {
    const { fetchMock } = install(gm);
    const r = await run({ source: 'file', path: '../a.png' }, gm);
    expect(r.error?.code).toBe('INVALID_ARGS');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('refuses SVG content in a .png file whatever the content type', async () => {
    install(gm, { bytes: SVG });
    const r = await run({ source: 'file', path: 'a.png' }, gm);
    expect(r.error?.code).toBe('INVALID_ARGS');
  });
  it('stops reading past the 4 MB cap and cancels the reader', async () => {
    const big = new Uint8Array(3 * 1024 * 1024);
    const { fetchMock } = install(gm, { chunks: [big, big, big] });
    const r = await run({ source: 'file', path: 'a.png' }, gm);
    expect(r.error?.code).toBe('INVALID_ARGS');
    expect(r.error.message).toContain(String(4 * 1024 * 1024));
    expect((fetchMock as any).cancel).toHaveBeenCalled();
  });
});

describe('image_view handler: downscale', () => {
  it('downscales a large image to a 1568 px JPEG and says so', async () => {
    const { canvases, close } = install(gm, { dims: [3136, 1568] });
    const r = await run({ source: 'file', path: 'a.png' }, gm);
    expect(canvases[0]).toMatchObject({ width: 1568, height: 784 });
    expect(r.images[0].mimeType).toBe('image/jpeg');
    expect(r.text).toContain('1568x784');
    expect(r.text).toMatch(/[Dd]ownscaled/);
    expect(r.text).not.toContain('Not downscaled');
    expect(close).toHaveBeenCalled();
  });
  it('re-encodes a small-dimension image over 512 KiB without resizing', async () => {
    const { canvases } = install(gm, {
      dims: [800, 600],
      bytes: Uint8Array.from({ length: MAX_IMAGE_BYTES + 1 }, (_, i) => (i < 8 ? PNG[i]! : 0)),
    });
    const r = await run({ source: 'file', path: 'a.png' }, gm);
    expect(canvases[0]).toMatchObject({ width: 800, height: 600 });
    expect(r.images[0].mimeType).toBe('image/jpeg');
  });
  it('refuses when still over 512 KiB after re-encoding, stating size and cap', async () => {
    install(gm, { dims: [4000, 3000], jpegBytes: MAX_IMAGE_BYTES + 1 });
    const r = await run({ source: 'file', path: 'a.png' }, gm);
    expect(r.error.code).toBe('INVALID_ARGS');
    expect(r.error.message).toContain(String(MAX_IMAGE_BYTES + 1));
    expect(r.error.message).toContain(String(MAX_IMAGE_BYTES));
  });
  it('fits MAX_FRAME_BYTES with the largest allowed image', async () => {
    install(gm, { dims: [4000, 3000], jpegBytes: MAX_IMAGE_BYTES });
    const r = await run({ source: 'file', path: 'a.png' }, gm);
    const frame = { type: 'result', id: 'x'.repeat(36), ok: true, text: r.text, images: r.images };
    expect(ResultMessage.safeParse(frame).success).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(frame))).toBeLessThanOrEqual(MAX_FRAME_BYTES);
  });
});
