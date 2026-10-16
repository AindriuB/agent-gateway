/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageAssign } from '@agent-gateway/protocol';
import { createDispatcher } from '../../src/ops/dispatch.js';
import { createAuditStage } from '../../src/audit/stage.js';
import { undoClasses } from '../../src/audit/undo-classes.js';
import { undoEntry } from '../../src/audit/undo.js';
import { HANDLERS } from '../../src/tools/index.js';
import { reserveFixtureUndo, updatePage } from './fake.js';
import { g, gm, setup } from '../tools/image-assign/fixtures.js';

const LEVEL = 'Scene.s.Level.defaultLevel0000';
let f: ReturnType<typeof setup>;
beforeEach(() => {
  f = setup(14);
});
afterEach(() => {
  f.restore();
  vi.restoreAllMocks();
});

describe('undoClasses for a Level', () => {
  it('accepts a Level embedded in a Scene', () => {
    expect(undoClasses('Scene.S.Level.L')).toEqual({ root: 'Scene', own: 'Level' });
  });
  it('still refuses a Level under a root that is not undoable and an unknown embedded class', () => {
    expect(undoClasses('User.U.Level.L')).toBeNull();
    expect(undoClasses('Scene.S.Nonsense.L')).toBeNull();
  });
});

describe('Undo of a v14 scene_background set', () => {
  it('snapshots the Level as undoable and Undo restores its previous background.src', async () => {
    const { level, scene } = f.docs;
    level.background.src = 'old-level.png';
    level.toObject = () => ({ _id: level.id, background: { src: level.background.src } });
    level.update.mockImplementation(async (change: any) => {
      Object.assign(level, JSON.parse(JSON.stringify(change)));
      scene.background = { src: level.background.src };
      return level;
    });
    const records: any[] = [];
    const dispatch = createDispatcher({
      tools: [imageAssign],
      handlers: { image_assign: HANDLERS.image_assign! },
      stages: [
        createAuditStage({
          categoryOf: () => imageAssign.category,
          isGM: () => true,
          fromUuid: async (uuid: string) => g.fromUuid(uuid),
          submit: async (r) => {
            records.push(r);
          },
          newId: () => 'entry-level0001',
          now: () => 1,
          watchChanges: () => () => {},
        }),
      ],
    });
    g.game.user = gm;
    const result: any = await dispatch(
      {
        tool: 'image_assign',
        args: { action: 'set', path: 'x.png', target: 'scene_background', uuid: 'Scene.s' },
        agent: { id: 'agent', ownerUserId: 'gm', headless: false },
        sessionId: 'session',
      },
      gm,
    );
    expect(result.error).toBeUndefined();
    expect(level.background.src).toBe('x.png');
    const t = records[0].targets.find((x: any) => x.uuid === LEVEL);
    expect(t).toMatchObject({ undoable: true, existed: true });
    expect(t.before.background.src).toBe('old-level.png');

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
    expect(out.skipped).not.toContain(LEVEL);
    expect(level.background.src).toBe('old-level.png');
  });
});
