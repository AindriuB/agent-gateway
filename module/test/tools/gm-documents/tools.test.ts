// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  documentCreate,
  documentUpdate,
  documentDelete,
  compendiumImport,
  TOOLS,
  checkToolDefinition,
  toJsonSchema,
} from '@agent-gateway/protocol';
import { HANDLERS } from '../../../src/tools/index.js';
import { parseData } from '../../../src/tools/_documents.js';
import { computeDiff, updatedDocument } from '../../../src/apps/approval/model.js';
import { setup, g } from './fixtures.js';
let f: ReturnType<typeof setup>;
beforeEach(() => {
  f = setup();
});
afterEach(() => {
  f.restore();
});
const call = (tool: string, args: any, ctx = f.ctx(tool, args)) =>
  Promise.resolve(HANDLERS[tool]!(ctx));
const create = (type = 'Actor', data: any = { name: 'New' }, rest: any = {}) => ({
  type,
  data: JSON.stringify(data),
  ...rest,
});
const update = (doc: any, data: any = { name: 'Changed' }) => ({
  uuid: doc.uuid,
  update: JSON.stringify(data),
});
const rejected = { error: { code: 'FORBIDDEN' } };

describe('closed GM schemas and bounded raw JSON', () => {
  it.each([documentCreate, documentUpdate, documentDelete, compendiumImport])(
    'registers checked core $name',
    (d) => {
      expect(TOOLS).toContain(d);
      expect(HANDLERS[d.name]).toBeTypeOf('function');
      expect(
        checkToolDefinition(
          {
            ...toJsonSchema(d),
            name: d.name,
            description: d.description,
            minRole: d.minRole,
            handledBy: d.handledBy,
            category: d.category,
          },
          'core',
        ),
      ).toEqual([]);
    },
  );
  it.each([
    'null',
    '[]',
    '"text"',
    'true',
    '{',
    '{"n":1e400}',
    '{"__proto__":{}}',
    '{"a.-=constructor.b":1}',
    '{"a":{"-=prototype":1}}',
  ])('refuses malformed/prototype JSON %s', (value) => expect(() => parseData(value)).toThrow());
  it('bounds UTF-8, depth and work before native parsing/merge', () => {
    expect(() => parseData(JSON.stringify({ value: 'é'.repeat(32768) }))).toThrow('64 KiB');
    expect(() => parseData('{"a":'.repeat(18) + '0' + '}'.repeat(18))).toThrow('structural');
    expect(() => parseData(JSON.stringify({ a: Array(5000).fill(0) }))).toThrow('structural');
  });
  it.each([
    'User',
    'Setting',
    'Macro',
    'Adventure',
    'Scene',
    'Token',
    'Combat',
    'Folder',
    'Cards',
    'ChatMessage',
    'RollTable',
    'Playlist',
  ])('rejects excluded class %s in schema', (type) =>
    expect(documentCreate.input.safeParse(create(type)).success).toBe(false),
  );
  it('caps grouped deletes and keeps schemas closed', () => {
    expect(documentDelete.input.safeParse({ uuids: Array(21).fill('Actor.a') }).success).toBe(
      false,
    );
    expect(
      documentUpdate.input.safeParse({ uuid: 'Actor.a', update: '{}', recursive: false }).success,
    ).toBe(false);
  });
});

describe('canonical native create and fresh authorization', () => {
  it.each(['Actor', 'Item', 'JournalEntry'])(
    'creates supported root %s with audited options',
    async (type) => {
      const args = create(type);
      const ctx = f.ctx('document_create', args);
      const result = await call('document_create', args, ctx);
      expect(result).toHaveProperty('structured.uuid');
      expect(ctx.intendCreate).toHaveBeenCalledBefore(f.classes[type].create);
      const made = f.mutations.at(-1);
      expect(made.options).toBe(ctx.callOptions);
      expect(ctx.created).toHaveBeenCalledWith((result as any).structured.uuid, undefined);
    },
  );
  it.each([
    ['Actor', 'Item'],
    ['Actor', 'ActiveEffect'],
    ['Item', 'ActiveEffect'],
    ['JournalEntry', 'JournalEntryPage'],
  ])('creates %s embedded %s', async (parentType, type) => {
    const parent = f.doc(parentType);
    const args = create(type, { name: 'Child' }, { parentUuid: parent.uuid });
    const ctx = f.ctx('document_create', args);
    const result = await call('document_create', args, ctx);
    expect(result).toHaveProperty('structured.uuid');
    expect(parent.createEmbeddedDocuments).toHaveBeenCalledWith(
      type,
      [{ name: 'Child' }],
      ctx.callOptions,
    );
    expect(ctx.created).toHaveBeenCalledWith((result as any).structured.uuid, parent);
  });
  it('supports ActiveEffect inside a canonical actor-owned Item', async () => {
    const actor = f.doc('Actor');
    const item = f.doc('Item', {}, actor);
    expect(
      await call('document_create', create('ActiveEffect', {}, { parentUuid: item.uuid })),
    ).toHaveProperty('structured.uuid');
  });
  it.each([
    ['Item', 'JournalEntry'],
    ['JournalEntryPage', 'Actor'],
    ['ActiveEffect', 'JournalEntry'],
    ['Actor', 'Actor'],
  ])('refuses %s under %s', async (type, parentType) => {
    const parent = f.doc(parentType);
    expect(
      await call('document_create', create(type, {}, { parentUuid: parent.uuid })),
    ).toMatchObject(rejected);
    expect(f.mutations).toHaveLength(0);
  });
  it('accepts matching folder and refuses mismatch/missing/embedded destinations', async () => {
    f.folder('Actor');
    expect(await call('document_create', create('Actor', {}, { folder: 'folder' }))).toHaveProperty(
      'structured.uuid',
    );
    f.mutations.length = 0;
    expect(await call('document_create', create('Item', {}, { folder: 'folder' }))).toMatchObject(
      rejected,
    );
    expect(await call('document_create', create('Actor', {}, { folder: 'missing' }))).toMatchObject(
      rejected,
    );
    const actor = f.doc('Actor');
    expect(
      await call(
        'document_create',
        create('Item', {}, { folder: 'folder', parentUuid: actor.uuid }),
      ),
    ).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect(f.mutations).toHaveLength(0);
  });
  it.each(['demote', 'logout', 'parent', 'folder', 'permission'])(
    'refuses %s changed during audit intent',
    async (scenario) => {
      const parent = f.doc('Actor');
      const folder = f.folder('Actor');
      const args = create(
        scenario === 'parent' || scenario === 'permission' ? 'Item' : 'Actor',
        {},
        scenario === 'parent' || scenario === 'permission'
          ? { parentUuid: parent.uuid }
          : { folder: folder.id },
      );
      const ctx = f.ctx('document_create', args);
      ctx.intendCreate.mockImplementation(async () => {
        if (scenario === 'demote') f.gm.isGM = false;
        if (scenario === 'logout') g.game.user = undefined;
        if (scenario === 'parent') f.collections.get('Actor').set(parent.id, { ...parent });
        if (scenario === 'folder') g.game.folders.set(folder.id, { ...folder });
        if (scenario === 'permission') parent.allowed = false;
      });
      expect(await call('document_create', args, ctx)).toMatchObject(rejected);
      expect(f.mutations).toHaveLength(0);
    },
  );
  it('refuses spoofed GM hints and missing audit capabilities', async () => {
    const args = create();
    g.game.user = f.player;
    expect(
      await call(
        'document_create',
        args,
        f.ctx('document_create', args, { id: f.player.id, isGM: true }),
      ),
    ).toMatchObject(rejected);
    g.game.user = f.gm;
    const ctx = f.ctx('document_create', args);
    delete ctx.snapshot;
    expect(await call('document_create', args, ctx)).toMatchObject({ error: { code: 'INTERNAL' } });
    expect(f.mutations).toHaveLength(0);
  });
  it('rejects missing/cancelled native creation', async () => {
    f.classes.Actor.create.mockResolvedValue(undefined);
    await expect(call('document_create', create())).rejects.toThrow('canonical');
  });
});

const unsafe = [
  { _id: 'chosen' },
  { '_stats.modifiedTime': 0 },
  { '-=pack': null },
  { parentUuid: 'Actor.a' },
  { flags: { 'agent-gateway': { auditJournal: false } } },
  { 'flags.-=agent-gateway': null },
  { '-=flags.x': null },
  { flags: [] },
  { '-=flags': null },
  { flags: { '-=agent-gateway.x': null } },
  { type: 'agent-gateway.audit' },
  { items: [{ _id: 'chosen' }] },
];
describe('raw updates, protected metadata and safe diff', () => {
  it.each(unsafe)('refuses unsafe fields %j', async (change) => {
    const doc = f.doc('Actor');
    expect(await call('document_update', update(doc, change))).toHaveProperty('error');
    expect(doc.update).not.toHaveBeenCalled();
  });
  it('uses actual shared diff for nested/dotted/deletion raw changes and preserves reserved metadata', async () => {
    const doc = f.doc('Actor', {
      name: 'Old',
      system: { old: 1, nested: { a: 2 } },
      flags: { 'agent-gateway': { retained: true } },
    });
    const change = { 'system.-=old': null, 'system.nested.a': 3, flags: { custom: { value: 5 } } };
    const before = doc.toObject();
    expect(computeDiff(before, updatedDocument(before, change))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'system.old', new: '—' }),
        expect.objectContaining({ path: 'system.nested.a', new: '3' }),
      ]),
    );
    const ctx = f.ctx('document_update', update(doc, change));
    expect(await call('document_update', ctx.args, ctx)).toHaveProperty('structured.uuid');
    expect(doc.flags['agent-gateway']).toEqual({ retained: true });
    expect(doc.system).toEqual({ nested: { a: 3 } });
    expect(ctx.snapshot).toHaveBeenCalledWith(doc.uuid);
    expect(doc.update).toHaveBeenCalledWith(change, ctx.callOptions);
  });
  it.each([
    { prototypeToken: { flags: { 'agent-gateway': { value: false } } } },
    { 'prototypeToken.flags.-=agent-gateway': null },
    { 'prototypeToken.-=flags.x': null },
    { '-=prototypeToken': null },
    { system: { custom: [{ flags: { 'agent-gateway': { value: false } } }] } },
    { prototypeToken: { custom: [[{ 'flags.-=agent-gateway': null }]] } },
  ])('protects nested reserved namespace and ancestor erasure %j', async (change) => {
    const doc = f.doc('Actor', { prototypeToken: { flags: { 'agent-gateway': { value: true } } } });
    expect(await call('document_update', update(doc, change))).toHaveProperty('error');
    expect(doc.update).not.toHaveBeenCalled();
    expect(await call('document_create', create('Actor', change))).toHaveProperty('error');
  });
  it('keeps normal Actor prototypeToken configuration available', async () => {
    const doc = f.doc('Actor');
    expect(
      await call('document_update', update(doc, { prototypeToken: { name: 'Default', width: 2 } })),
    ).toHaveProperty('structured.uuid');
  });
  it('refuses unreviewable before source and >1000 diff rows', async () => {
    const a = f.doc('Actor', {
      system: Object.fromEntries(Array.from({ length: 1001 }, (_, n) => [`k${n}`, n])),
    });
    expect(
      await call(
        'document_update',
        update(a, {
          system: Object.fromEntries(Array.from({ length: 1001 }, (_, n) => [`k${n}`, n + 1])),
        }),
      ),
    ).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    a.toObject = () => ({ system: { value: 'x'.repeat(1000001) } });
    expect(await call('document_update', update(a))).toMatchObject({
      error: { code: 'INVALID_ARGS' },
    });
    expect(a.update).not.toHaveBeenCalled();
  });
  it.each(['demote', 'replace', 'audit', 'permission', 'folder'])(
    'refuses %s changed during snapshot',
    async (scenario) => {
      const doc = f.doc('Actor');
      const folder = f.folder('Actor');
      const args = update(doc, scenario === 'folder' ? { folder: folder.id } : { name: 'X' });
      const ctx = f.ctx('document_update', args);
      ctx.snapshot.mockImplementation(async () => {
        if (scenario === 'demote') f.gm.isGM = false;
        if (scenario === 'replace') f.collections.get('Actor').set(doc.id, { ...doc });
        if (scenario === 'audit') doc.flags = { 'agent-gateway': { auditJournal: true } };
        if (scenario === 'permission') doc.allowed = false;
        if (scenario === 'folder') g.game.folders.set(folder.id, { ...folder });
      });
      expect(await call('document_update', args, ctx)).toMatchObject(rejected);
      expect(doc.update).not.toHaveBeenCalled();
    },
  );
  it('validates folder moves and permits native null clearing', async () => {
    const doc = f.doc('Actor');
    f.folder('Item');
    expect(await call('document_update', update(doc, { folder: 'folder' }))).toMatchObject(
      rejected,
    );
    expect(await call('document_update', update(doc, { 'folder.x': 'folder' }))).toHaveProperty(
      'error',
    );
    expect(await call('document_update', update(doc, { folder: null }))).toHaveProperty(
      'structured.uuid',
    );
  });
  it('refuses audit journals and descendants before snapshots or mutation', async () => {
    const journal = f.doc('JournalEntry', { flags: { 'agent-gateway': { auditJournal: true } } });
    const page = f.doc('JournalEntryPage', { type: 'text' }, journal);
    for (const doc of [journal, page])
      expect(await call('document_update', update(doc, { flags: {} }))).toMatchObject(rejected);
    expect(f.mutations).toHaveLength(0);
  });
  it('protects an existing audit subtype even when its journal flag is absent', async () => {
    const journal = f.doc('JournalEntry');
    const page = f.doc('JournalEntryPage', { type: 'agent-gateway.audit' }, journal);
    expect(await call('document_update', update(page, { name: 'No' }))).toMatchObject(rejected);
    expect(await call('document_delete', { uuids: [journal.uuid] })).toMatchObject(rejected);
    expect(f.mutations).toHaveLength(0);
  });
  it('refuses a vetoed native update rather than claiming success', async () => {
    const doc = f.doc('Actor');
    doc.update.mockResolvedValue(undefined);
    await expect(call('document_update', update(doc))).rejects.toThrow('cancelled');
  });
});

describe('grouped deletes validate all members and retain honest partial failures', () => {
  it('deduplicates and snapshots all members before any mutation', async () => {
    const a = f.doc('Actor'),
      b = f.doc('Item');
    const args = { uuids: [a.uuid, b.uuid, a.uuid] };
    const ctx = f.ctx('document_delete', args);
    expect(await call('document_delete', args, ctx)).toMatchObject({
      structured: { deleted: 2, uuids: [a.uuid, b.uuid] },
    });
    expect(ctx.snapshot).toHaveBeenCalledTimes(2);
    expect(ctx.snapshot).toHaveBeenCalledBefore(a.delete);
    expect(b.delete).toHaveBeenCalledWith(ctx.callOptions);
  });
  it('rejects an invalid final member, unsupported/pack targets and ancestor overlap before deletes', async () => {
    const a = f.doc('Actor'),
      item = f.doc('Item', {}, a);
    for (const uuids of [
      [a.uuid, 'Actor.missing'],
      [a.uuid, item.uuid],
      [a.uuid, 'Scene.s'],
      [a.uuid, 'Compendium.test.pack.Actor.a'],
    ]) {
      expect(await call('document_delete', { uuids })).toHaveProperty('error');
      expect(a.delete).not.toHaveBeenCalled();
    }
  });
  it('revalidates complete set after snapshots and each later native await', async () => {
    const a = f.doc('Actor'),
      b = f.doc('Item');
    const args = { uuids: [a.uuid, b.uuid] };
    const ctx = f.ctx('document_delete', args);
    ctx.snapshot.mockImplementation(async (uuid: string) => {
      if (uuid === b.uuid) a.allowed = false;
    });
    expect(await call('document_delete', args, ctx)).toMatchObject(rejected);
    expect(a.delete).not.toHaveBeenCalled();
    expect(b.delete).not.toHaveBeenCalled();
    a.allowed = true;
    a.delete.mockImplementation(async () => {
      f.docs.delete(a.uuid);
      f.collections.get('Actor').delete(a.id);
      b.allowed = false;
      return a;
    });
    ctx.snapshot.mockResolvedValue(undefined);
    expect(await call('document_delete', args, ctx)).toMatchObject(rejected);
    expect(f.docs.has(a.uuid)).toBe(false);
    expect(b.delete).not.toHaveBeenCalled();
  });
  it('fails honestly if a later native deletion vetoes', async () => {
    const a = f.doc('Actor'),
      b = f.doc('Item');
    b.delete.mockResolvedValue(undefined);
    await expect(call('document_delete', { uuids: [a.uuid, b.uuid] })).rejects.toThrow('cancelled');
    expect(f.docs.has(a.uuid)).toBe(false);
    expect(f.docs.has(b.uuid)).toBe(true);
  });
});

describe('native-shaped compendium copy conversion', () => {
  it.each([13, 14] as const)(
    'imports a fresh audited world copy on v%i without source identity replacement',
    async (generation) => {
      f.restore();
      f = setup(generation);
      const existing = f.doc('Actor', { _id: 'source', name: 'Existing' });
      const { entry } = f.pack();
      const folder = f.folder('Actor');
      const before = entry.toObject();
      const args = { uuid: entry.uuid, folder: folder.id };
      const ctx = f.ctx('compendium_import', args);
      const result = await call('compendium_import', args, ctx);
      expect(result).toHaveProperty('structured.uuid');
      expect((result as any).structured.uuid).not.toBe(existing.uuid);
      expect(existing.name).toBe('Existing');
      expect(entry.toObject()).toEqual(before);
      const mutation = f.mutations.at(-1);
      expect(mutation.data.ownership).toEqual({ default: 0, gm: 3 });
      expect(mutation.data.folder).toBe(folder.id);
      expect(mutation.options).toBe(ctx.callOptions);
      expect(ctx.created).toHaveBeenCalledWith((result as any).structured.uuid, undefined);
    },
  );
  it.each(['demote', 'pack', 'folder', 'hidden'])(
    'refuses stale %s after awaited pack loading',
    async (scenario) => {
      const { entry, pack } = f.pack();
      const folder = f.folder('Actor');
      pack.getDocument.mockImplementation(async () => {
        if (scenario === 'demote') f.gm.isGM = false;
        if (scenario === 'pack') g.game.packs.set(pack.collection, { ...pack });
        if (scenario === 'folder') g.game.folders.delete(folder.id);
        if (scenario === 'hidden') pack.testUserPermission.mockReturnValue(false);
        return entry;
      });
      expect(
        await call('compendium_import', { uuid: entry.uuid, folder: folder.id }),
      ).toMatchObject(rejected);
      expect(f.mutations).toHaveLength(0);
    },
  );
  it('refuses unsupported, noncanonical and audit-marked source entries', async () => {
    const { entry } = f.pack();
    for (const uuid of ['Actor.source', 'Compendium.test.pack.source', `${entry.uuid}.Item.child`])
      expect(await call('compendium_import', { uuid })).toMatchObject(rejected);
    (entry as any).flags = { 'agent-gateway': { auditJournal: true } };
    expect(await call('compendium_import', { uuid: entry.uuid })).toMatchObject(rejected);
    expect(f.mutations).toHaveLength(0);
  });
  it('rechecks compendium entry visibility and identity after awaited creation intent', async () => {
    const { entry, pack } = f.pack();
    const args = { uuid: entry.uuid };
    const ctx = f.ctx('compendium_import', args);
    ctx.intendCreate.mockImplementation(async () => {
      pack.testUserPermission.mockReturnValue(false);
    });
    expect(await call('compendium_import', args, ctx)).toMatchObject(rejected);
    expect(f.mutations).toHaveLength(0);
  });
  it('retains native scoped embedded IDs in imported copies while refusing protected descendants', async () => {
    const { entry } = f.pack();
    const data = {
      ...entry.toObject(),
      items: [{ _id: 'scoped', name: 'Item', effects: [{ _id: 'effect', name: 'Effect' }] }],
    };
    entry.toObject = () => structuredClone(data);
    expect(await call('compendium_import', { uuid: entry.uuid })).toHaveProperty('structured.uuid');
    expect(f.mutations.at(-1).data.items[0]._id).toBe('scoped');
    f.mutations.length = 0;
    data.items[0].effects[0] = {
      _id: 'effect',
      name: 'Effect',
      flags: { 'agent-gateway': { x: true } },
    } as any;
    expect(await call('compendium_import', { uuid: entry.uuid })).toHaveProperty('error');
    expect(f.mutations).toHaveLength(0);
  });
  it('refuses a missing pack entry before native conversion', async () => {
    const { entry, pack } = f.pack();
    pack.getDocument.mockResolvedValue(undefined as any);
    expect(await call('compendium_import', { uuid: entry.uuid })).toMatchObject(rejected);
    expect(f.collections.get('Actor').fromCompendium).not.toHaveBeenCalled();
  });
});
