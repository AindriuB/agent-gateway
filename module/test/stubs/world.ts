/* eslint-disable @typescript-eslint/no-explicit-any */
import { installFoundry, type FoundryStub } from './foundry.js';

export const gmUser = { id: 'gm1', name: 'Gamemaster', role: 4, isGM: true };
export const playerUser = { id: 'p1', name: 'Pat', role: 1, isGM: false };
export const ownerUser = { id: 'p2', name: 'Olive', role: 1, isGM: false };

export class HTMLField {}
export class JavaScriptField {}
const HTML = new HTMLField();
const CODE = new JavaScriptField();
export { HTML as htmlField, CODE as codeField };

export interface FakeDocInit {
  id: string;
  name: string;
  documentName: string;
  uuid?: string;
  folder?: { id: string; name: string };
  /** user ids who may observe (owners always may) */
  observers?: string[];
  /** user ids who own */
  owners?: string[];
  /** embedded documents have an ownership field only when this is true (top-level docs always do) */
  ownership?: boolean;
  hidden?: boolean;
  data?: Record<string, unknown>;
  /** Schema fields (SchemaField-like `{ fields }`, `{ element }`, HTMLField, JavaScriptField, plain objects) */
  schema?: Record<string, unknown>;
  /** Embedded documents by collection name. */
  embedded?: Record<string, any[]>;
  modifiedTime?: number;
  entry?: any;
}

export function fakeDoc(init: FakeDocInit): any {
  const owners = init.owners ?? [];
  const observers = init.observers ?? [];
  const toObjectCalls = { count: 0 };
  const embedded = init.embedded ?? {};
  const doc: any = {
    id: init.id,
    uuid: init.uuid ?? `${init.documentName}.${init.id}`,
    name: init.name,
    documentName: init.documentName,
    folder: init.folder,
    hidden: init.hidden,
    entry: init.entry,
    data: init.data ?? {},
    modifiedTime: init.modifiedTime ?? 1,
    _stats: { modifiedTime: init.modifiedTime ?? 1 },
    _source: init.ownership === false ? {} : { ownership: {} },
    schema: init.schema ? { fields: init.schema } : undefined,
    constructor: {
      metadata: {
        embedded: Object.fromEntries(Object.keys(embedded).map((c) => [`E_${c}`, c])),
      },
    },
    toObjectCalls,
    testUserPermission: (user: { id: string; isGM?: boolean }, level: string) =>
      user.isGM === true ||
      owners.includes(user.id) ||
      (level === 'OBSERVER' && observers.includes(user.id)),
    toObject() {
      toObjectCalls.count += 1;
      const out: Record<string, unknown> = { _id: init.id, name: init.name, ...this.data };
      for (const [coll, kids] of Object.entries(embedded))
        out[coll] = kids.map((k) => k.toObject());
      return out;
    },
  };
  for (const [coll, kids] of Object.entries(embedded)) {
    doc[coll] = kids;
    for (const k of kids) k.parent = doc;
  }
  return doc;
}

const collection = (docs: any[]) => ({
  contents: docs,
  get: (id: string) => docs.find((d) => d.id === id),
});

export interface WorldSetup {
  docs?: Record<string, any[]>;
  activeScene?: { name: string; navName?: string };
  combatActive?: boolean;
  optIn?: boolean;
}

export function setupWorld(w: WorldSetup = {}): FoundryStub {
  const stub = installFoundry(14);
  const g = globalThis as any;
  const docs = w.docs ?? {};
  const byUuid = new Map<string, any>();
  const index = (d: any) => {
    byUuid.set(d.uuid, d);
    for (const key of Object.keys(d.constructor.metadata.embedded).map(
      (k) => d.constructor.metadata.embedded[k],
    ))
      for (const kid of d[key]) {
        kid.uuid = `${d.uuid}.${kid.documentName}.${kid.id}`;
        index(kid);
      }
  };
  for (const list of Object.values(docs)) for (const d of list) index(d);
  Object.assign(g.game, {
    world: { id: 'my-world', title: 'My World' },
    system: { id: 'dnd5e', version: '5.1.0' },
    users: collection([gmUser, playerUser, ownerUser]),
    actors: collection(docs.actors ?? []),
    items: collection(docs.items ?? []),
    journal: collection(docs.journal ?? []),
    scenes: Object.assign(collection(docs.scenes ?? []), { active: w.activeScene }),
    tables: collection(docs.tables ?? []),
    macros: collection(docs.macros ?? []),
    playlists: collection(docs.playlists ?? []),
    combats: { active: w.combatActive ? {} : undefined },
  });
  g.foundry.data = { fields: { HTMLField, JavaScriptField } };
  stub.registeredSettings.set('agent-gateway.includeOtherModuleData', {
    name: '',
    scope: 'world',
    config: true,
    type: Boolean,
    default: w.optIn === true,
  });
  g.fromUuid = async (uuid: string) => byUuid.get(uuid) ?? null;
  return stub;
}
