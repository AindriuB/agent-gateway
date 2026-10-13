// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HANDLERS } from '../../../src/tools/index.js';
import { setup, g } from '../gm-documents/fixtures.js';

let f: ReturnType<typeof setup>;
let entry: any;
beforeEach(() => {
  f = setup();
  g.game.system = { id: 'starfinder' };
  ({ entry } = f.pack('Item'));
  entry.toObject = () => ({ _id: 'source', name: 'Sword', type: 'weapon', system: {}, flags: {} });
});
afterEach(() => f.restore());
const call = (args: any, ctx = f.ctx('compendium_import', args)) =>
  Promise.resolve(HANDLERS['compendium_import']!(ctx));
const embeds = () => f.mutations.filter((m) => m.kind === 'createEmbedded');

describe('compendium_import with actorUuid', () => {
  it('embeds the entry in the Actor and records it', async () => {
    const actor = f.doc('Actor', { _id: 'a1', name: 'PC' });
    const args = { uuid: entry.uuid, actorUuid: actor.uuid };
    const ctx = f.ctx('compendium_import', args);
    const result: any = await call(args, ctx);
    expect(result.structured.created).toHaveLength(1);
    expect(result.structured.uuid).toBe(result.structured.created[0]);
    expect(result.structured.uuid).toMatch(/^Actor\.a1\.Item\./);
    expect(ctx.intendCreate).toHaveBeenCalledWith(actor);
    expect(ctx.created).toHaveBeenCalledWith(result.structured.uuid, actor);
    expect(embeds()[0].options).toBe(ctx.callOptions);
    expect(embeds()[0].entries[0]._id).toBeUndefined();
    expect(result.text).not.toMatch(/uncorrelated|incomplete/);
  });

  it('drops pack-only root keys a real compendium source carries (folder: null, sort)', async () => {
    // Live pf2e shape, probed 2026-10-13: _id, img, name, system, type, _stats, effects, folder, sort, ownership, flags.
    entry.toObject = () => ({
      _id: 'source',
      img: 'icons/x.webp',
      name: 'Dagger',
      type: 'weapon',
      system: {},
      _stats: { compendiumSource: null },
      effects: [],
      folder: null,
      sort: 100000,
      ownership: { default: 0 },
      flags: {},
    });
    f.collections.get('Item').fromCompendium.mockImplementation((e: any, o: any) => {
      const data = structuredClone(e.toObject());
      if (!o.keepId) delete data._id;
      return data;
    });
    const actor = f.doc('Actor', { _id: 'a1', name: 'PC' });
    const result: any = await call({ uuid: entry.uuid, actorUuid: actor.uuid });
    expect(result.error).toBeUndefined();
    const sent = embeds()[0].entries[0];
    expect(sent).not.toHaveProperty('folder');
    expect(sent).not.toHaveProperty('sort');
    expect(sent.name).toBe('Dagger');
  });

  it('records every document the native call returns', async () => {
    const actor = f.doc('Actor', { _id: 'a1', name: 'PC' });
    actor.createEmbeddedDocuments.mockImplementation(async () => [
      f.doc('Item', { name: 'a' }, actor),
      f.doc('Item', { name: 'b' }, actor),
      f.doc('Item', { name: 'c' }, actor),
    ]);
    const args = { uuid: entry.uuid, actorUuid: actor.uuid };
    const ctx = f.ctx('compendium_import', args);
    const result: any = await call(args, ctx);
    expect(ctx.created).toHaveBeenCalledTimes(3);
    expect(result.structured.created).toHaveLength(3);
    expect(result.text).toMatch(/3 documents/);
  });

  it('says the audit is incomplete past 50 documents', async () => {
    const actor = f.doc('Actor', { _id: 'a1', name: 'PC' });
    actor.createEmbeddedDocuments.mockImplementation(async () =>
      Array.from({ length: 51 }, (_, i) => f.doc('Item', { name: `i${i}` }, actor)),
    );
    const args = { uuid: entry.uuid, actorUuid: actor.uuid };
    const ctx = f.ctx('compendium_import', args);
    const result: any = await call(args, ctx);
    expect(ctx.created).toHaveBeenCalledTimes(51);
    expect(result.structured.created).toHaveLength(50);
    expect(result.text).toMatch(/audit is incomplete/);
  });

  it('refuses a non-owned Actor for a player', async () => {
    const actor = f.doc('Actor', { _id: 'a1', name: 'PC' });
    const args = { uuid: entry.uuid, actorUuid: actor.uuid };
    const ctx = f.ctx('compendium_import', args, f.player);
    g.game.user = f.player;
    const result: any = await call(args, ctx);
    expect(result.error.code).toBe('FORBIDDEN');
    expect(embeds()).toHaveLength(0);
  });

  it('refuses a compendium Actor entry', async () => {
    const { entry: actorEntry } = f.pack('Actor');
    const actor = f.doc('Actor', { _id: 'a1', name: 'PC' });
    const result: any = await call({ uuid: actorEntry.uuid, actorUuid: actor.uuid });
    expect(result.error.code).toMatch(/FORBIDDEN|INVALID_ARGS/);
    expect(embeds()).toHaveLength(0);
    expect(f.collections.get('Item').fromCompendium).not.toHaveBeenCalled();
  });

  it('refuses a token Actor', async () => {
    const actor = f.doc('Actor', { _id: 'a1', name: 'PC' });
    const token = f.doc('Actor', { _id: 't1', name: 'Token' });
    f.collections.get('Actor').delete('t1');
    (token as any).uuid = 'Scene.s.Token.t.Actor.t1';
    f.docs.set(token.uuid, token);
    const result: any = await call({ uuid: entry.uuid, actorUuid: token.uuid });
    expect(result.error.code).toMatch(/FORBIDDEN|INVALID_ARGS/);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(token.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it('refuses an audit-flagged entry', async () => {
    const actor = f.doc('Actor', { _id: 'a1', name: 'PC' });
    entry.flags = { 'agent-gateway': { auditJournal: true } };
    const result: any = await call({ uuid: entry.uuid, actorUuid: actor.uuid });
    expect(result.error.code).toMatch(/FORBIDDEN|INVALID_ARGS/);
    expect(embeds()).toHaveLength(0);
  });

  it('the schema rejects folder with actorUuid and overrides without it', async () => {
    const actor = f.doc('Actor', { _id: 'a1', name: 'PC' });
    const folder = f.folder('Item');
    await expect(
      call({ uuid: entry.uuid, actorUuid: actor.uuid, folder: folder.id }),
    ).rejects.toThrow(/folder cannot be combined/);
    await expect(call({ uuid: entry.uuid, overrides: { quantity: 2 } })).rejects.toThrow(
      /overrides require actorUuid/,
    );
    expect(f.mutations).toHaveLength(0);
  });

  it('the generic hook refuses overrides and passes an empty set', async () => {
    const actor = f.doc('Actor', { _id: 'a1', name: 'PC' });
    const refused: any = await call({
      uuid: entry.uuid,
      actorUuid: actor.uuid,
      overrides: { quantity: 2 },
    });
    expect(refused.error).toEqual({
      code: 'INVALID_ARGS',
      message: 'Override not supported for starfinder',
    });
    expect(embeds()).toHaveLength(0);
    const ok: any = await call({ uuid: entry.uuid, actorUuid: actor.uuid, overrides: {} });
    expect(ok.structured.uuid).toBeDefined();
  });

  it('refuses when the entry becomes hidden during the audit intent', async () => {
    const actor = f.doc('Actor', { _id: 'a1', name: 'PC' });
    const args = { uuid: entry.uuid, actorUuid: actor.uuid };
    const ctx = f.ctx('compendium_import', args);
    ctx.intendCreate.mockImplementation(async () => {
      g.game.packs.get('test.pack').testUserPermission.mockReturnValue(false);
    });
    const result: any = await call(args, ctx);
    expect(result.error.code).toBe('FORBIDDEN');
    expect(embeds()).toHaveLength(0);
  });

  it('keeps the world import unchanged without actorUuid', async () => {
    const world = f.pack('Actor');
    const result: any = await call({ uuid: world.entry.uuid });
    expect(result.structured.created).toBeUndefined();
    expect(result.structured.uuid).toMatch(/^Actor\./);
  });
});

describe('uncorrelated native writes', () => {
  // Foundry's Hooks.on/off: a hook id is returned and removes only that listener.
  const listeners = new Map<number, [string, (...a: any[]) => void]>();
  let nextId = 1;
  const fire = (name: string, ...args: any[]) =>
    [...listeners.values()].filter(([n]) => n === name).forEach(([, fn]) => fn(...args));
  beforeEach(() => {
    listeners.clear();
    g.Hooks.on = (name: string, fn: any) => (listeners.set(nextId, [name, fn]), nextId++);
    g.Hooks.off = (_name: string, id: number) => listeners.delete(id);
  });
  const run = async (events: Array<[string, any, any]>) => {
    g.game.system = { id: 'pf2e' };
    const actor = f.doc('Actor', { _id: 'a1', name: 'PC' });
    const stranger = f.doc('Actor', { _id: 'a2', name: 'Other' });
    const original = actor.createEmbeddedDocuments;
    actor.createEmbeddedDocuments = vi.fn(async (...a: any[]) => {
      for (const [name, doc, options] of events) {
        const owner = doc === 'other' ? stranger : actor;
        const item = { parent: owner };
        if (name === 'updateItem') fire(name, item, {}, options, 'gm');
        else fire(name, item, options, 'gm');
      }
      return original(...a);
    });
    const result: any = await call({ uuid: entry.uuid, actorUuid: actor.uuid });
    return result;
  };
  it('names them only when they happened', async () => {
    const plain = { render: false };
    expect((await run([['updateItem', 'actor', plain]])).text).toMatch(/1 native.*task 44/);
    expect((await run([['updateItem', 'actor', plain]])).text).toMatch(
      /concurrent writes.*unawaited Actor update/,
    );
    expect((await run([])).text).not.toMatch(/uncorrelated/);
  });
  it('ignores writes that carry an audit callId or touch another Actor', async () => {
    const audited = { agentGateway: { callId: 'c' } };
    const result = await run([
      ['updateItem', 'actor', audited],
      ['deleteItem', 'actor', audited],
      ['updateItem', 'other', { render: false }],
    ]);
    expect(result.text).not.toMatch(/uncorrelated/);
  });
  it('counts deletes and removes its hooks, also for overlapping calls', async () => {
    const [a, b] = await Promise.all([
      run([['deleteItem', 'actor', {}]]),
      run([['deleteItem', 'actor', {}]]),
    ]);
    expect(a.text).toMatch(/uncorrelated/);
    expect(b.text).toMatch(/uncorrelated/);
    expect(listeners.size).toBe(0);
  });
});
