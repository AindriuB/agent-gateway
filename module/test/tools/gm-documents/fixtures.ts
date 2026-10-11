/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from 'vitest';
import { installFoundry } from '../../stubs/foundry.js';
import { updatedDocument } from '../../../src/apps/approval/model.js';
export const g = globalThis as any;
export function setup(generation: 13 | 14 = 14) {
  const stub = installFoundry(generation);
  const gm = { id: 'gm', isGM: true };
  const player = { id: 'player', isGM: false };
  g.game.user = gm;
  g.game.users = new Map([
    [gm.id, gm],
    [player.id, player],
  ]);
  const docs = new Map<string, any>();
  const types = ['Actor', 'Item', 'JournalEntry', 'ActiveEffect', 'JournalEntryPage'];
  const embedded: any = {
    Actor: { Item: 'items', ActiveEffect: 'effects' },
    Item: { ActiveEffect: 'effects' },
    JournalEntry: { JournalEntryPage: 'pages' },
  };
  const collections = new Map<string, any>();
  const classes: any = {};
  let seq = 0;
  const mutations: any[] = [];
  function doc(type: string, data: any = {}, parent?: any): any {
    const id = data._id ?? `new${++seq}`;
    const d: any = {
      id,
      documentName: type,
      parent,
      uuid: parent ? `${parent.uuid}.${type}.${id}` : `${type}.${id}`,
      pack: undefined,
      flags: {},
      allowed: true,
      _stats: { modifiedTime: seq + 10 },
      ...data,
    };
    d.constructor = classes[type];
    d.toObject = () => {
      const result = { _id: id, _stats: { ...d._stats }, flags: structuredClone(d.flags) } as any;
      for (const key of ['name', 'type', 'system', 'text', 'folder', 'prototypeToken'])
        if (d[key] !== undefined) result[key] = structuredClone(d[key]);
      for (const [name, field] of Object.entries(embedded[type] ?? {})) {
        const children = d.getEmbeddedCollection(name);
        if (field in data || children.size)
          result[field as string] = children.contents.map((child: any) => child.toObject());
      }
      return result;
    };
    d.testUserPermission = vi.fn((user: any) => user.isGM && d.allowed);
    d.canUserModify = vi.fn((user: any) => user.isGM && d.allowed);
    d.children = new Map();
    d.getEmbeddedCollection = (name: string) => {
      if (!d.children.has(name)) {
        const collection: any = new Map();
        Object.defineProperty(collection, 'contents', { get: () => [...collection.values()] });
        d.children.set(name, collection);
      }
      return d.children.get(name);
    };
    for (const [name, field] of Object.entries(embedded[type] ?? {}))
      d[field as string] = d.getEmbeddedCollection(name);
    d.collection = parent ? parent.getEmbeddedCollection(type) : collections.get(type);
    d.update = vi.fn(async (change: any, options: any) => {
      mutations.push({ kind: 'update', d, change, options });
      Object.assign(d, updatedDocument(d.toObject(), change));
      d._stats.modifiedTime++;
      return d;
    });
    d.delete = vi.fn(async (options: any) => {
      mutations.push({ kind: 'delete', d, options });
      docs.delete(d.uuid);
      (parent ? parent.getEmbeddedCollection(type) : collections.get(type)).delete(id);
      return d;
    });
    d.createEmbeddedDocuments = vi.fn(async (name: string, entries: any[], options: any) => {
      mutations.push({ kind: 'createEmbedded', parent: d, name, entries, options });
      return entries.map((data) => doc(name, data, d));
    });
    docs.set(d.uuid, d);
    (parent ? parent.getEmbeddedCollection(type) : collections.get(type))?.set(id, d);
    return d;
  }
  for (const type of types) {
    const cls = {
      documentName: type,
      metadata: { embedded: embedded[type] ?? {} },
      canUserCreate: vi.fn((user: any) => user.isGM),
      fromSource: vi.fn((data: any, options: any) => ({
        documentName: type,
        parent: options.parent,
        canUserModify: (user: any, action: string) => action === 'create' && user.isGM,
      })),
      create: vi.fn(async (data: any, options: any) => {
        mutations.push({ kind: 'create', type, data, options });
        return doc(type, options?.keepId ? data : { ...data, _id: undefined });
      }),
    };
    classes[type] = cls;
    const collection: any = new Map();
    collection.documentClass = cls;
    collection.fromCompendium = vi.fn((entry: any, options: any) => {
      const data = structuredClone(entry.toObject());
      if (!options.keepId) delete data._id;
      if (options.clearFolder) delete data.folder;
      delete data.sort;
      delete data.active;
      data.ownership = { default: 0, [gm.id]: 3 };
      data._stats = { compendiumSource: entry.uuid };
      return data;
    });
    collections.set(type, collection);
  }
  g.game.collections = collections;
  g.game.folders = new Map();
  g.game.packs = new Map();
  g.foundry.utils ??= {};
  g.foundry.utils.getDocumentClass = (name: string) => classes[name];
  g.getDocumentClass = g.foundry.utils.getDocumentClass;
  g.fromUuid = vi.fn(async (uuid: string) => docs.get(uuid));
  const ctx = (tool: string, args: unknown, who = gm): any => ({
    tool,
    args,
    user: who,
    agent: { id: 'agent', ownerUserId: who.id, headless: false },
    sessionId: 'session',
    snapshot: vi.fn(async () => {}),
    intendCreate: vi.fn(async () => {}),
    created: vi.fn(async () => {}),
    callOptions: { agentGateway: { callId: 'call' } },
  });
  function folder(type: string, id = 'folder'): any {
    const f = {
      id,
      uuid: `Folder.${id}`,
      documentName: 'Folder',
      type,
      testUserPermission: (u: any) => u.isGM,
    };
    g.game.folders.set(id, f);
    return f;
  }
  function pack(type = 'Actor'): any {
    const entry = {
      id: 'source',
      uuid: `Compendium.test.pack.${type}.source`,
      pack: 'test.pack',
      documentName: type,
      toObject: () => ({
        _id: 'source',
        name: 'Source',
        type: 'npc',
        folder: 'foreign',
        sort: 10,
        active: true,
        ownership: { default: 3 },
        flags: {},
        items: [],
      }),
    };
    const p = {
      collection: 'test.pack',
      documentName: type,
      testUserPermission: vi.fn(() => true),
      getDocument: vi.fn(async () => entry),
      get: (id: string) => (id === entry.id ? entry : undefined),
    };
    g.game.packs.set(p.collection, p);
    return { entry, pack: p };
  }
  return {
    gm,
    player,
    docs,
    classes,
    collections,
    mutations,
    doc,
    ctx,
    folder,
    pack,
    restore() {
      stub.uninstall();
      delete g.getDocumentClass;
    },
  };
}
