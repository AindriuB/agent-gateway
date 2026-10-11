/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  restoreDeletedSubtree,
  UncertainRestorationError,
} from '../../src/audit/undo-restoration.js';
import { undoEntry } from '../../src/audit/undo.js';
import { target, updatePage } from './fake.js';

const clone = (v: any) => JSON.parse(JSON.stringify(v));
function nativeRig() {
  const docs = new Map<string, any>();
  const writes: string[] = [];
  const user = { id: 'gm', isGM: true };
  const state = {
    held: true,
    denied: false,
    strip: true,
    veto: '',
    throwAfter: '',
    wrongReturn: false,
    transform: false,
    afterCreate: () => {},
  };
  const metadata: Record<string, any> = {
    Actor: { Item: 'items', ActiveEffect: 'effects' },
    Item: { ActiveEffect: 'effects' },
    JournalEntry: { JournalEntryPage: 'pages' },
    ActiveEffect: {},
    JournalEntryPage: {},
  };
  const classes: Record<string, any> = {};
  for (const [name, embedded] of Object.entries(metadata)) {
    classes[name] = class NativeDocument {
      static metadata = { embedded };
      static canUserCreate() {
        // Native UI affordance constructs a blank strict sample and can fail required-name validation.
        try {
          new this({}, { strict: true });
          return true;
        } catch {
          return false;
        }
      }
      static fromSource(data: any, options: any) {
        return new this(data, options);
      }
      static async create(data: any, options: any) {
        return create(name, data, null, options);
      }
      id: string;
      uuid: string;
      parent: any;
      data: any;
      _stats = { modifiedTime: 1 };
      flags: any;
      constructor(data: any, options: any = {}) {
        if (options.strict && !data.name) throw Error('required native name');
        this.data = clone(data);
        this.id = data._id;
        this.parent = options.parent ?? null;
        this.uuid = this.parent ? `${this.parent.uuid}.${name}.${this.id}` : `${name}.${this.id}`;
        this.flags = data.flags;
        (this as any).documentName = name;
        (this as any).collection = {
          get: (id: string) =>
            docs.get(this.parent ? `${this.parent.uuid}.${name}.${id}` : `${name}.${id}`),
        };
        for (const collection of Object.values(embedded) as string[])
          (this as any)[collection] = {
            contents: [],
            get(id: string) {
              return this.contents.find((doc: any) => doc.id === id);
            },
          };
      }
      canUserModify(who: any, action: string) {
        if (action === 'create')
          return (
            who === user &&
            !state.denied &&
            (!this.parent || this.parent.testUserPermission(who, 'OWNER'))
          );
        return !state.denied;
      }
      testUserPermission(who: any, level: string) {
        return who === user && level === 'OWNER' && !state.denied;
      }
      toObject() {
        const data = { ...clone(this.data), _stats: clone(this._stats) };
        for (const collection of Object.values(embedded) as string[]) {
          if (collection in this.data || (this as any)[collection].contents.length)
            data[collection] = (this as any)[collection].contents.map((v: any) => v.toObject());
        }
        return data;
      }
      async createEmbeddedDocuments(childName: string, data: any[], options: any) {
        return Promise.all(data.map((value) => create(childName, value, this, options)));
      }
    };
  }
  async function create(name: string, data: any, parent: any, options: any) {
    writes.push(`${name}.${data._id}`);
    expect(options).toMatchObject({ keepId: true, keepEmbeddedIds: true });
    if (state.veto === name) return null;
    const source = clone(data);
    if (state.strip && ['Actor', 'Item'].includes(name)) source.effects = [];
    if (state.transform) source.name += ' changed';
    const doc = new classes[name](source, { parent });
    docs.set(doc.uuid, doc);
    if (parent) parent[parent.constructor.metadata.embedded[name]].contents.push(doc);
    for (const [childName, collection] of Object.entries(metadata[name])) {
      for (const child of source[collection as string] ?? [])
        await create(childName, child, doc, options);
    }
    state.afterCreate();
    if (state.throwAfter === name) throw Error('lost native acknowledgement');
    return state.wrongReturn ? {} : doc;
  }
  const deps = {
    isGM: () => user.isGM && state.held,
    userId: () => user.id,
    fromUuid: async (uuid: string) => docs.get(uuid) ?? null,
    canCreate: () => !state.denied,
    canModify: () => !state.denied,
    getClass: (name: string) => classes[name],
  };
  vi.stubGlobal('game', { user });
  vi.stubGlobal('getDocumentClass', deps.getClass);
  return { docs, writes, classes, deps, state, user, create };
}
const effect = { _id: 'e1', name: 'Dead', statuses: ['dead'], disabled: false };
const actor = { _id: 'a1', name: 'Saved NPC', effects: [effect], items: [] };
function pageFor(before: any, uuid = 'Actor.a1') {
  return {
    id: 'undo-entry',
    system: {
      targets: [
        {
          ...target({ uuid, before, existsAfter: false, afterModifiedTime: null }),
          before: JSON.stringify(before),
        },
      ],
      undoCompleted: [],
      undoneAt: null,
    },
    update: vi.fn(updatePage),
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('native deleted-subtree restoration', () => {
  it.each(['Actor', 'Item'])(
    'repairs effects stripped by native %s root creation before completing',
    async (name) => {
      const r = nativeRig();
      const before = { ...actor, _id: 'root' };
      const uuid = `${name}.root`;
      const p = pageFor(before, uuid);
      expect(
        await undoEntry(p, async () => true, {
          ...r.deps,
          reserve: async () => ({ page: p, isHeld: () => r.state.held, release: async () => {} }),
        }),
      ).toMatchObject({ status: 'done', restored: 1 });
      expect(r.docs.get(`${uuid}.ActiveEffect.e1`).toObject()).toMatchObject(effect);
      expect(p.system.undoCompleted).toEqual([uuid]);
      expect(p.system.undoneAt).toEqual(expect.any(Number));
      expect(r.writes).toEqual([`${name}.root`, 'ActiveEffect.e1']);
    },
  );
  it('restores Actor Item effects after both system hooks and retains Journal pages without duplicates', async () => {
    const r = nativeRig();
    await restoreDeletedSubtree(
      'Actor.a1',
      { ...actor, items: [{ _id: 'i1', name: 'Item', effects: [clone(effect)] }] },
      null,
      r.deps,
    );
    expect(r.docs.has('Actor.a1.Item.i1.ActiveEffect.e1')).toBe(true);
    await restoreDeletedSubtree(
      'JournalEntry.j1',
      {
        _id: 'j1',
        name: 'Journal',
        pages: [{ _id: 'p1', name: 'Page', type: 'text', text: { content: 'saved' } }],
      },
      null,
      r.deps,
    );
    expect(r.writes.filter((v) => v === 'JournalEntryPage.p1')).toHaveLength(1);
  });
  it.each(['JournalEntryPage', 'ActiveEffect'])(
    'uses saved required-name native candidate and canonical parent permission for %s',
    async (name) => {
      const r = nativeRig();
      const parentName = name === 'ActiveEffect' ? 'Actor' : 'JournalEntry';
      const parent = await r.create(parentName, { _id: 'parent', name: 'Parent' }, null, {
        keepId: true,
        keepEmbeddedIds: true,
      });
      expect(r.classes[name].canUserCreate()).toBe(false);
      await restoreDeletedSubtree(
        `${parent.uuid}.${name}.child`,
        { _id: 'child', name: 'Valid child' },
        null,
        r.deps,
      );
      expect(r.docs.has(`${parent.uuid}.${name}.child`)).toBe(true);
    },
  );
  it('confirmed settled partial retry fills only missing descendants and never duplicates the root', async () => {
    const r = nativeRig();
    const p = pageFor(actor);
    const reserve = async () => ({ page: p, isHeld: () => true, release: async () => {} });
    r.state.veto = 'ActiveEffect';
    expect(await undoEntry(p, async () => true, { ...r.deps, reserve })).toMatchObject({
      status: 'failed',
      restored: 0,
    });
    expect(p.system.undoCompleted).toEqual([]);
    expect(p.system.undoneAt).toBeNull();
    r.state.veto = '';
    const confirm = vi.fn(async () => true);
    expect(await undoEntry(p, confirm, { ...r.deps, reserve })).toMatchObject({
      status: 'done',
      restored: 1,
    });
    expect(confirm).toHaveBeenCalled();
    expect(r.writes.filter((v) => v === 'Actor.a1')).toHaveLength(1);
    expect(r.docs.get('Actor.a1').effects.contents).toHaveLength(1);
  });
  it('apply-then-reject leaves reservation for manual recovery and never records success', async () => {
    const r = nativeRig();
    const p = pageFor(actor);
    const release = vi.fn();
    r.state.throwAfter = 'ActiveEffect';
    await expect(
      undoEntry(p, async () => true, {
        ...r.deps,
        reserve: async () => ({ page: p, isHeld: () => true, release }),
      }),
    ).rejects.toBeInstanceOf(UncertainRestorationError);
    expect(r.docs.has('Actor.a1.ActiveEffect.e1')).toBe(true);
    expect(release).not.toHaveBeenCalled();
    expect(p.update).not.toHaveBeenCalled();
  });
  it.each(['wrongReturn', 'transform'])(
    'refuses %s rather than marking incomplete native restore done',
    async (key) => {
      const r = nativeRig();
      (r.state as any)[key] = true;
      const p = pageFor(actor);
      expect(
        await undoEntry(p, async () => true, {
          ...r.deps,
          reserve: async () => ({ page: p, isHeld: () => true, release: async () => {} }),
        }),
      ).toMatchObject({ status: 'failed', restored: 0 });
      expect(p.update).not.toHaveBeenCalled();
    },
  );
  it.each(['demotion', 'reservation', 'ownership', 'identity'])(
    'refuses %s after awaited root creation before child mutation',
    async (why) => {
      const r = nativeRig();
      r.state.afterCreate = () => {
        if (why === 'demotion') r.user.isGM = false;
        if (why === 'reservation') r.state.held = false;
        if (why === 'ownership') r.state.denied = true;
        if (why === 'identity') r.docs.set('Actor.a1', {});
      };
      await expect(restoreDeletedSubtree('Actor.a1', actor, null, r.deps)).rejects.toThrow();
      expect(r.writes).toEqual(['Actor.a1']);
    },
  );
  it('refuses differing existing child data or unexpected children on confirmed retries', async () => {
    const r = nativeRig();
    const root = await r.create('Actor', actor, null, { keepId: true, keepEmbeddedIds: true });
    await r.create('ActiveEffect', { ...effect, name: 'Intervening' }, root, {
      keepId: true,
      keepEmbeddedIds: true,
    });
    await expect(restoreDeletedSubtree(root.uuid, actor, root, r.deps)).rejects.toThrow('differs');
    expect(r.writes).toHaveLength(2);
    root.effects.contents[0].id = 'extra';
    await expect(restoreDeletedSubtree(root.uuid, actor, root, r.deps)).rejects.toThrow(
      'unexpected',
    );
  });
  it.each(['earlier child', 'extra child', 'nested _stats'])(
    'final synchronous subtree scan catches later hook changing %s',
    async (why) => {
      const r = nativeRig();
      const saved = clone(actor);
      saved.effects.push({ ...clone(effect), _id: 'e2' });
      if (why === 'nested _stats')
        (saved.effects[0] as any).system = { _stats: { custom: 'saved' } };
      r.state.afterCreate = () => {
        if (r.writes.at(-1) !== 'ActiveEffect.e2') return;
        const earlier = r.docs.get('Actor.a1.ActiveEffect.e1');
        if (why === 'earlier child') earlier.data.name = 'Changed by later hook';
        if (why === 'nested _stats') earlier.data.system._stats.custom = 'changed';
        if (why === 'extra child') {
          const parent = r.docs.get('Actor.a1');
          const extra = new r.classes.ActiveEffect({ ...clone(effect), _id: 'extra' }, { parent });
          r.docs.set(extra.uuid, extra);
          parent.effects.contents.push(extra);
        }
      };
      const p = pageFor(saved);
      expect(
        await undoEntry(p, async () => true, {
          ...r.deps,
          reserve: async () => ({ page: p, isHeld: () => true, release: async () => {} }),
        }),
      ).toMatchObject({ status: 'failed', restored: 0 });
      expect(p.update).not.toHaveBeenCalled();
    },
  );
  it('keeps independent successful targets complete while a subtree remains incomplete', async () => {
    const r = nativeRig();
    r.state.veto = 'ActiveEffect';
    const p = pageFor(actor);
    p.system.targets.unshift({
      ...target({
        uuid: 'JournalEntry.j1',
        before: { _id: 'j1', name: 'Saved' },
        existsAfter: false,
        afterModifiedTime: null,
      }),
      before: JSON.stringify({ _id: 'j1', name: 'Saved' }),
    });
    expect(
      await undoEntry(p, async () => true, {
        ...r.deps,
        reserve: async () => ({ page: p, isHeld: () => true, release: async () => {} }),
      }),
    ).toMatchObject({ status: 'failed', restored: 1, failed: ['Actor.a1'] });
    expect(p.system.undoCompleted).toEqual(['JournalEntry.j1']);
    expect(p.system.undoneAt).toBeNull();
  });
  it.each(['denied', 'missingName', 'protected'])(
    'refuses %s direct embedded recreation before any create',
    async (why) => {
      const r = nativeRig();
      const parent = await r.create('JournalEntry', { _id: 'j1', name: 'Parent' }, null, {
        keepId: true,
        keepEmbeddedIds: true,
      });
      r.writes.length = 0;
      if (why === 'denied') r.state.denied = true;
      if (why === 'protected') parent.flags = { 'agent-gateway': { auditJournal: true } };
      await expect(
        restoreDeletedSubtree(
          'JournalEntry.j1.JournalEntryPage.p1',
          { _id: 'p1', ...(why === 'missingName' ? {} : { name: 'Page' }) },
          null,
          r.deps,
        ),
      ).rejects.toThrow();
      expect(r.writes).toEqual([]);
    },
  );
  it('rejects a replaced canonical parent during an awaited direct embedded check', async () => {
    const r = nativeRig();
    await r.create('JournalEntry', { _id: 'j1', name: 'Parent' }, null, {
      keepId: true,
      keepEmbeddedIds: true,
    });
    const original = r.deps.fromUuid;
    let reads = 0;
    r.deps.fromUuid = async (uuid) => {
      const doc = await original(uuid);
      if (++reads === 2) r.docs.set(uuid, {});
      return reads === 2 ? {} : doc;
    };
    await expect(
      restoreDeletedSubtree(
        'JournalEntry.j1.JournalEntryPage.p1',
        { _id: 'p1', name: 'Page' },
        null,
        r.deps,
      ),
    ).rejects.toThrow('parent changed');
    expect(r.writes).toEqual(['JournalEntry.j1']);
  });
  it('rejects changed parent version before missing-child creation', async () => {
    const r = nativeRig();
    const root = await r.create('Actor', actor, null, { keepId: true, keepEmbeddedIds: true });
    const original = r.deps.fromUuid;
    r.deps.fromUuid = async (uuid) => {
      const doc = await original(uuid);
      if (uuid.endsWith('ActiveEffect.e1')) root._stats.modifiedTime++;
      return doc;
    };
    await expect(restoreDeletedSubtree('Actor.a1', actor, root, r.deps)).rejects.toThrow(
      'version changed',
    );
    expect(r.writes).toEqual(['Actor.a1']);
  });
  it.each(['cycle', 'descendants', 'protected'])(
    'refuses %s saved subtree before mutation',
    async (why) => {
      const r = nativeRig();
      const data: any = clone(actor);
      if (why === 'cycle') data.system = data;
      if (why === 'descendants')
        data.effects = Array.from({ length: 257 }, (_, i) => ({ ...clone(effect), _id: `e${i}` }));
      if (why === 'protected') data.flags = { 'agent-gateway': { auditJournal: true } };
      await expect(restoreDeletedSubtree('Actor.a1', data, null, r.deps)).rejects.toThrow();
      expect(r.writes).toEqual([]);
    },
  );
  it.each(['duplicate', 'prototype', 'depth', 'nodes', 'size', 'unsupported'])(
    'rejects %s plans before any mutation',
    async (why) => {
      const r = nativeRig();
      const data: any = clone(actor);
      if (why === 'duplicate') data.effects.push(clone(effect));
      if (why === 'prototype') data.system = JSON.parse('{"__proto__":{}}');
      if (why === 'depth') {
        let node = data;
        for (let i = 0; i < 34; i++) node = node.next = {};
      }
      if (why === 'nodes') data.system = Array(20_001).fill(1);
      if (why === 'size') data.name = 'x'.repeat(200_001);
      if (why === 'unsupported') {
        r.classes.Actor.metadata.embedded.User = 'users';
        data.users = [{ _id: 'u', name: 'Unsafe' }];
      }
      await expect(restoreDeletedSubtree('Actor.a1', data, null, r.deps)).rejects.toThrow();
      expect(r.writes).toEqual([]);
    },
  );
});
