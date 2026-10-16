/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageAssign } from '@agent-gateway/protocol';
import { createDispatcher } from '../../../src/ops/dispatch.js';
import { createAuditStage } from '../../../src/audit/stage.js';
import { undoEntry } from '../../../src/audit/undo.js';
import { HANDLERS } from '../../../src/tools/index.js';
import { reserveFixtureUndo, updatePage } from '../../audit/fake.js';
import { g, gm, setup } from './fixtures.js';

type Case = {
  target: string;
  uuid: string;
  gen: 13 | 14;
  doc: (d: any) => any;
  /** The fields the document's `toObject` reports (what the audit snapshots). */
  fields: (d: any) => Record<string, unknown>;
  read: (d: any) => unknown;
  old: string;
};

const cases: Case[] = [
  {
    target: 'actor_portrait',
    uuid: 'Actor.a',
    gen: 14,
    doc: (d) => d.actor,
    fields: (a) => ({
      img: a.img,
      prototypeToken: { texture: { src: a.prototypeToken.texture.src } },
    }),
    read: (d) => d.actor.img,
    old: 'old.png',
  },
  {
    target: 'actor_token',
    uuid: 'Actor.a',
    gen: 14,
    doc: (d) => d.actor,
    fields: (a) => ({
      img: a.img,
      prototypeToken: { texture: { src: a.prototypeToken.texture.src } },
    }),
    read: (d) => d.actor.prototypeToken.texture.src,
    old: 'old-t.png',
  },
  {
    target: 'token',
    uuid: 'Scene.s.Token.t',
    gen: 14,
    doc: (d) => d.mine,
    fields: (t) => ({ texture: { src: t.texture.src } }),
    read: (d) => d.mine.texture.src,
    old: 'old-tok.png',
  },
  {
    target: 'tile',
    uuid: 'Scene.s.Tile.tl',
    gen: 14,
    doc: (d) => d.tile,
    fields: (t) => ({ texture: { src: t.texture.src } }),
    read: (d) => d.tile.texture.src,
    old: 'old-tile.png',
  },
  {
    target: 'scene_background',
    uuid: 'Scene.s',
    gen: 13,
    doc: (d) => d.scene,
    fields: (s) => ({ background: { src: s.background.src } }),
    read: (d) => d.scene.background.src,
    old: 'old-bg.png',
  },
];

let f: ReturnType<typeof setup> | undefined;
afterEach(() => {
  f?.restore();
  vi.restoreAllMocks();
});

describe('Undo of an image_assign set (real dispatch, then undoEntry)', () => {
  it.each(cases)('$target (v$gen): Undo restores the previous value', async (c) => {
    f = setup(c.gen);
    const target = c.doc(f.docs);
    target.toObject = () => ({ _id: target.id, ...JSON.parse(JSON.stringify(c.fields(target))) });
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
          newId: () => 'entry-image0001',
          now: () => 1,
          watchChanges: () => () => {},
        }),
      ],
    });
    g.game.user = gm;
    const result: any = await dispatch(
      {
        tool: 'image_assign',
        args: { action: 'set', path: 'x.png', target: c.target, uuid: c.uuid },
        agent: { id: 'agent', ownerUserId: 'gm', headless: false },
        sessionId: 'session',
      },
      gm,
    );
    expect(result.error).toBeUndefined();
    expect(c.read(f.docs)).toBe('x.png');
    const t = records[0].targets.find((x: any) => x.uuid === c.uuid);
    expect(t).toMatchObject({ undoable: true, existed: true });

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
    expect(out.skipped).not.toContain(c.uuid);
    expect(c.read(f.docs)).toBe(c.old);
  });
});
