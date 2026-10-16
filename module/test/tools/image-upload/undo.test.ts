/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageUpload } from '@agent-gateway/protocol';
import { createDispatcher } from '../../../src/ops/dispatch.js';
import { createAuditStage } from '../../../src/audit/stage.js';
import { undoEntry } from '../../../src/audit/undo.js';
import { imageUploadHandler } from '../../../src/tools/image-upload.js';
import { reserveFixtureUndo, updatePage } from '../../audit/fake.js';
import { installFoundry } from '../../stubs/foundry.js';

const g = globalThis as any;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const gm = { id: 'gm', isGM: true, can: () => true };
let stub: ReturnType<typeof installFoundry> | undefined;
afterEach(() => {
  stub?.uninstall();
  vi.restoreAllMocks();
  for (const k of ['fromUuid', 'foundry']) delete g[k];
});

function world(gen: 13 | 14) {
  stub = installFoundry(gen);
  const level: any = {
    id: 'defaultLevel0000',
    uuid: 'Scene.s.Level.defaultLevel0000',
    documentName: 'Level',
    background: { src: 'old-bg.png' },
    _stats: { modifiedTime: 1 },
    testUserPermission: () => true,
    canUserModify: () => true,
  };
  level.toObject = () => ({ _id: level.id, background: { src: level.background.src } });
  level.update = vi.fn(async (d: any) => {
    const next = d['background.src'] ?? d.background?.src;
    if (next !== undefined) {
      level.background.src = next;
      scene.background.src = next;
    }
    return level;
  });
  const scene: any = {
    id: 's',
    uuid: 'Scene.s',
    documentName: 'Scene',
    background: { src: 'old-bg.png' },
    levels: Object.assign(new Map([[level.id, level]]), { contents: [level] }),
    _stats: { modifiedTime: 1 },
    testUserPermission: () => true,
    canUserModify: () => true,
  };
  level.parent = scene;
  scene.toObject = () => ({ _id: 's', background: { src: scene.background.src } });
  scene.update = vi.fn(async (d: any) => {
    const next = d['background.src'] ?? d.background?.src;
    if (next !== undefined) scene.background.src = next;
    return scene;
  });
  scene.updateEmbeddedDocuments = vi.fn(async (_n: string, rows: any[]) => {
    // v14: the scene background mirrors its Level.
    level.background.src = rows[0]['background.src'];
    scene.background.src = level.background.src;
    return [level];
  });
  const docs = new Map<string, any>([
    [scene.uuid, scene],
    [level.uuid, level],
  ]);
  g.fromUuid = vi.fn(async (u: string) => docs.get(u) ?? null);
  g.game.user = gm;
  g.game.users = { get: () => gm };
  const upload = vi.fn(async (_s: string, dir: string, f: File) => ({
    status: 'success',
    path: `${dir}/${f.name}`,
  }));
  g.foundry = {
    applications: {
      apps: {
        FilePicker: {
          implementation: {
            createDirectory: vi.fn(async () => {
              throw new Error('EEXIST');
            }),
            browse: vi.fn(async () => ({ files: [] })),
            upload,
          },
        },
      },
    },
  };
  return { scene, level };
}

describe.each([
  [14, 'Scene.s.Level.defaultLevel0000'],
  [13, 'Scene.s'],
] as const)('Undo of an image_upload scene background (v%i)', (gen, snapshotted) => {
  it('restores the previous background', async () => {
    const { scene } = world(gen);
    const records: any[] = [];
    const dispatch = createDispatcher({
      tools: [imageUpload],
      handlers: { image_upload: imageUploadHandler },
      stages: [
        createAuditStage({
          categoryOf: () => imageUpload.category,
          isGM: () => true,
          fromUuid: async (uuid: string) => g.fromUuid(uuid),
          submit: async (r) => void records.push(r),
          newId: () => 'entry-upload001',
          now: () => 1,
          watchChanges: () => () => {},
        }),
      ],
    });
    const result: any = await dispatch(
      {
        tool: 'image_upload',
        args: {
          data: PNG.toString('base64'),
          mime: 'image/png',
          sceneUuid: 'Scene.s',
          setBackground: true,
        },
        agent: { id: 'agent', ownerUserId: 'gm', headless: false },
        sessionId: 'session',
      },
      gm,
    );
    expect(result.error).toBeUndefined();
    expect(scene.background.src).toMatch(/^agent-gateway\/uploads\/gm\//);
    const target = records[0].targets.find((x: any) => x.uuid === snapshotted);
    expect(target).toMatchObject({ undoable: true, existed: true });

    const page: any = {
      system: {
        targets: records[0].targets.map((x: any) => ({
          ...x,
          before: x.before ? JSON.stringify(x.before) : '',
        })),
        undoneAt: null,
        undoneBy: '',
      },
      update: async (d: any) => updatePage.call(page, d),
    };
    const out = await undoEntry(page, async () => true, {
      reserve: reserveFixtureUndo,
      isGM: () => true,
      canModify: () => true,
      canCreate: () => true,
      userId: () => 'gm',
      fromUuid: async (uuid: string) => g.fromUuid(uuid),
      now: () => 2,
    });
    expect(out).toMatchObject({ status: 'done', failed: [] });
    expect(out.skipped).not.toContain(snapshotted);
    expect(scene.background.src).toBe('old-bg.png');
  });
});
