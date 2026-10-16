/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { imageUploadHandler } from '../../../src/tools/image-upload.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const b64 = (b: Buffer) => b.toString('base64');
const args = (extra: any = {}) => ({ data: b64(PNG), mime: 'image/png', ...extra });

let users: Record<string, any>;
let docs: Map<string, any>;
let fp: any;
let existing: string[];
let uploads: any[];
const call = (a: any, who = 'p1'): any => {
  (globalThis as any).game.user = users[who];
  return imageUploadHandler({
    tool: 'image_upload',
    args: a,
    user: { id: who, isGM: users[who].isGM },
    agent: { id: 'a', ownerUserId: who, headless: false },
    sessionId: 's',
    snapshot: snapshot,
    intendCreate: vi.fn(),
    created: vi.fn(),
    callOptions: { agentGateway: { callId: 'c1' } },
  } as any);
};
let snapshot: any;
const doc = (uuid: string, kind: string, extra: any = {}) => {
  const d: any = {
    uuid,
    documentName: kind,
    owners: new Set(['p1']),
    testUserPermission: (u: any) => u.isGM || d.owners.has(u.id),
    update: vi.fn(async () => d),
    ...extra,
  };
  docs.set(uuid, d);
  return d;
};

beforeEach(() => {
  const g = globalThis as any;
  users = {
    p1: { id: 'p1', isGM: false, can: (p: string) => p === 'FILES_UPLOAD' || p === 'FILES_BROWSE' },
    nobrowse: { id: 'nobrowse', isGM: false, can: (p: string) => p === 'FILES_UPLOAD' },
    noup: { id: 'noup', isGM: false, can: () => false },
    gm: { id: 'gm', isGM: true, can: () => true },
  };
  docs = new Map();
  existing = [];
  uploads = [];
  snapshot = vi.fn(async () => {});
  fp = {
    createDirectory: vi.fn(async () => {
      throw new Error('EEXIST: directory exists');
    }),
    browse: vi.fn(async () => ({ files: existing })),
    upload: vi.fn(async (_s: string, dir: string, file: File) => {
      uploads.push({ dir, file });
      return { status: 'success', path: `${dir}/${file.name}` };
    }),
  };
  g.game = { users: { get: (id: string) => users[id] }, release: { generation: 14 } };
  g.fromUuid = vi.fn(async (u: string) => docs.get(u));
  g.foundry = { applications: { apps: { FilePicker: { implementation: fp } } } };
});
afterEach(() => {
  const g = globalThis as any;
  delete g.game;
  delete g.fromUuid;
  delete g.foundry;
});

describe('image_upload validation', () => {
  it.each([
    ['SVG text', { data: Buffer.from('<svg xmlns="x"></svg>').toString('base64') }],
    ['mismatched magic', { data: b64(JPEG) }],
    ['bad base64', { data: 'not base64!!' }],
    ['bad padding length', { data: 'AAA' }],
    ['oversize', { data: b64(Buffer.concat([PNG, Buffer.alloc(512 * 1024 + 1 - PNG.length)])) }],
  ])('rejects %s with INVALID_ARGS and uploads nothing', async (_n, a) => {
    const r = await call(args(a));
    expect(r.error?.code).toBe('INVALID_ARGS');
    expect(fp.upload).not.toHaveBeenCalled();
  });
  it('rejects flags without a target and targets without flags', async () => {
    for (const a of [
      { setPortrait: true },
      { actorUuid: 'Actor.a' },
      { sceneUuid: 'Scene.s' },
      { setBackground: true },
    ])
      expect((await call(args(a), 'gm')).error?.code).toBe('INVALID_ARGS');
  });
  it('never constructs an image from the data', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../src/tools/image-upload.ts', import.meta.url),
      'utf8',
    );
    expect(src).not.toMatch(/new Image|createImageBitmap|getContext/);
  });
});

describe('image_upload storage', () => {
  it('stores under a server-named per-user path and returns hash and size', async () => {
    const r = await call(args());
    expect(r.error).toBeUndefined();
    const s = r.structured;
    expect(s.path).toMatch(/^agent-gateway\/uploads\/p1\/[0-9a-f]{24}-12\.png$/);
    expect(s.sha256).toBe(createHash('sha256').update(PNG).digest('hex'));
    expect(s.bytes).toBe(12);
    expect(r.text.split('\n')[0]).toContain(s.sha256);
    expect(r.text).toContain('does not delete the uploaded file');
    expect(r.text).not.toContain(b64(PNG));
    expect(uploads[0].dir).toBe('agent-gateway/uploads/p1');
    expect(fp.createDirectory.mock.calls.map((c: any[]) => c[1])).toEqual([
      'agent-gateway',
      'agent-gateway/uploads',
      'agent-gateway/uploads/p1',
    ]);
  });
  it('derives the extension from mime and ignores no caller text', async () => {
    const r = await call({ data: b64(JPEG), mime: 'image/jpeg' });
    expect(r.structured.path).toMatch(/\.jpg$/);
  });
  it('allows an upload that fits under 64 MiB but would have exceeded 8 MiB', async () => {
    existing = Array(16).fill('x/bb-524288.png');
    const r = await call(args());
    expect(r.error).toBeUndefined();
    expect(fp.upload).toHaveBeenCalledTimes(1);
  });
  it('refuses when the per-user quota of 64 MiB would be exceeded', async () => {
    existing = Array(128).fill('x/bb-524288.png');
    const r = await call(args());
    expect(r.error?.code).toBe('INVALID_ARGS');
    expect(r.error.message).toContain('quota');
    expect(fp.upload).not.toHaveBeenCalled();
  });
  it('counts a file whose name does not parse at the per-file cap', async () => {
    existing = Array(128).fill('x/odd.png');
    expect((await call(args())).error?.code).toBe('INVALID_ARGS');
  });
  it('reports the same SHA-256 the approval and audit show', async () => {
    const { redactedArgs } = await import('../../../src/ops/redact.js');
    const { imageUpload } = await import('@agent-gateway/protocol');
    const a = args();
    const shown = redactedArgs(imageUpload, a) as any;
    expect((await call(a)).structured.sha256).toBe(shown.data.sha256);
  });
  it('serialises one user: two concurrent 512 KiB uploads, room for one, give one success', async () => {
    // Usage is 64 MiB minus 600 KiB, so exactly one more 512 KiB file fits.
    existing = [...Array(126).fill('x/bb-524288.png'), 'x/aa-434176.png'];
    const tick = () => new Promise((r) => setTimeout(r, 5));
    fp.browse = vi.fn(async () => {
      await tick();
      return { files: [...existing] };
    });
    fp.upload = vi.fn(async (_s: string, dir: string, file: File) => {
      await tick();
      existing.push(`${dir}/${file.name}`);
      return { status: 'success', path: `${dir}/${file.name}` };
    });
    const big = Buffer.concat([PNG, Buffer.alloc(524288 - PNG.length)]);
    const a = args({ data: b64(big) });
    const results = await Promise.all([call(a), call(a)]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    const refused = results.filter((r) => r.error);
    expect(refused).toHaveLength(1);
    expect(refused[0].error.code).toBe('INVALID_ARGS');
    expect(refused[0].error.message).toContain('quota');
    expect(fp.upload).toHaveBeenCalledTimes(1);
  });
  it('fails when Foundry reports a failed upload', async () => {
    for (const bad of [false, undefined, {}]) {
      fp.upload.mockResolvedValueOnce(bad);
      expect((await call(args())).error?.code).toBe('INVALID_ARGS');
    }
  });
});

describe('image_upload permissions', () => {
  it('refuses a player without FILES_UPLOAD', async () => {
    const r = await call(args(), 'noup');
    expect(r.error?.code).toBe('FORBIDDEN');
    expect(fp.upload).not.toHaveBeenCalled();
  });
  it('refuses a player with FILES_UPLOAD but without FILES_BROWSE, naming it', async () => {
    const r = await call(args(), 'nobrowse');
    expect(r.error?.code).toBe('FORBIDDEN');
    expect(r.error.message).toContain('FILES_BROWSE');
    expect(fp.upload).not.toHaveBeenCalled();
  });
  it('refuses a player with no FILES_UPLOAD, naming it', async () => {
    const r = await call(args(), 'noup');
    expect(r.error.message).toContain('FILES_UPLOAD');
  });
  it('refuses a player on an Actor they do not own, before uploading', async () => {
    doc('Actor.other', 'Actor', { owners: new Set(['p2']) });
    const r = await call(args({ actorUuid: 'Actor.other', setPortrait: true }));
    expect(r.error?.code).toBe('FORBIDDEN');
    expect(fp.upload).not.toHaveBeenCalled();
  });
  it('refuses a player sending sceneUuid', async () => {
    doc('Scene.s', 'Scene');
    const r = await call(args({ sceneUuid: 'Scene.s', setBackground: true }));
    expect(r.error?.code).toBe('FORBIDDEN');
    expect(fp.upload).not.toHaveBeenCalled();
  });
  it('lets a player set only img and token art on an owned Actor, with snapshot and callOptions', async () => {
    const actor = doc('Actor.mine', 'Actor');
    const r = await call(args({ actorUuid: 'Actor.mine', setPortrait: true, setToken: true }));
    expect(r.error).toBeUndefined();
    const path = r.structured.path;
    expect(actor.update).toHaveBeenCalledWith(
      { img: path, 'prototypeToken.texture.src': path },
      { agentGateway: { callId: 'c1' } },
    );
    expect(snapshot).toHaveBeenCalledWith('Actor.mine');
    expect(r.structured.updated).toEqual(['Actor.mine']);
  });
  it('lets a GM target any Actor', async () => {
    const actor = doc('Actor.other', 'Actor', { owners: new Set(['p2']) });
    const r = await call(args({ actorUuid: 'Actor.other', setPortrait: true }), 'gm');
    expect(r.error).toBeUndefined();
    expect(actor.update).toHaveBeenCalledWith(
      { img: r.structured.path },
      expect.objectContaining({ agentGateway: expect.anything() }),
    );
  });
  it('refuses compendium Actors', async () => {
    doc('Actor.pk', 'Actor', { pack: 'w.p' });
    const r = await call(args({ actorUuid: 'Actor.pk', setPortrait: true }), 'gm');
    expect(r.error?.code).toBe('FORBIDDEN');
  });
});

describe('image_upload scene background', () => {
  it('v14 updates the first Level, snapshots the Scene and passes callOptions', async () => {
    const scene = doc('Scene.s', 'Scene', {
      levels: { contents: [{ id: 'defaultLevel0000' }] },
      updateEmbeddedDocuments: vi.fn(async () => []),
    });
    const r = await call(args({ sceneUuid: 'Scene.s', setBackground: true }), 'gm');
    expect(r.error).toBeUndefined();
    expect(scene.updateEmbeddedDocuments).toHaveBeenCalledWith(
      'Level',
      [{ _id: 'defaultLevel0000', 'background.src': r.structured.path }],
      { agentGateway: { callId: 'c1' } },
    );
    expect(snapshot).toHaveBeenCalledWith('Scene.s');
  });
  it('v13 updates background.src directly', async () => {
    (globalThis as any).game.release.generation = 13;
    const scene = doc('Scene.s', 'Scene');
    const r = await call(args({ sceneUuid: 'Scene.s', setBackground: true }), 'gm');
    expect(scene.update).toHaveBeenCalledWith(
      { 'background.src': r.structured.path },
      { agentGateway: { callId: 'c1' } },
    );
  });
});
