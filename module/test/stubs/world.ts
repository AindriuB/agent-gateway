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
  type?: string;
  folder?: { id: string; name: string };
  /** user ids who may observe (owners always may) */
  observers?: string[];
  /** user ids who own */
  owners?: string[];
  /** user ids who have LIMITED access only */
  limited?: string[];
  hidden?: boolean;
  disposition?: number;
  playing?: boolean;
  navName?: string;
  /** Scene state; `navigation` defaults to true as in Foundry. */
  active?: boolean;
  navigation?: boolean;
  data?: Record<string, unknown>;
  /** Schema fields (SchemaField-like `{ fields }`, `{ element }`, HTMLField, JavaScriptField, plain objects) */
  schema?: Record<string, unknown>;
  /** Embedded collections by collection name. */
  embedded?: Record<string, any[]>;
  /** Singular embedded documents (a token's `delta`) by name. */
  singular?: Record<string, any>;
  /** `null` leaves `_stats.modifiedTime` undefined. */
  modifiedTime?: number | null;
  entry?: any;
  page?: any;
  actor?: any;
  /** Share a class object (and its metadata) between documents of one type. */
  ctor?: any;
  /** Counts reads of `schema`. */
  schemaReads?: { count: number };
}

export function fakeDoc(init: FakeDocInit): any {
  const owners = init.owners ?? [];
  const observers = init.observers ?? [];
  const limited = init.limited ?? [];
  const toObjectCalls = { count: 0 };
  const permCalls = { count: 0 };
  const embedded = init.embedded ?? {};
  const singular = init.singular ?? {};
  const meta = Object.fromEntries(
    [...Object.keys(embedded), ...Object.keys(singular)].map((c) => [`E_${c}`, c]),
  );
  const time = init.modifiedTime === undefined ? 1 : init.modifiedTime;
  const doc: any = {
    id: init.id,
    uuid: init.uuid ?? `${init.documentName}.${init.id}`,
    name: init.name,
    documentName: init.documentName,
    type: init.type,
    folder: init.folder,
    hidden: init.hidden,
    disposition: init.disposition,
    playing: init.playing,
    navName: init.navName,
    active: init.active,
    navigation: init.navigation ?? true,
    entry: init.entry,
    page: init.page,
    actor: init.actor,
    data: init.data ?? {},
    _stats: time === null ? {} : { modifiedTime: time },
    constructor: init.ctor ?? { metadata: { embedded: meta } },
    toObjectCalls,
    permCalls,
    testUserPermission: (user: { id: string; isGM?: boolean }, level: string) => {
      permCalls.count += 1;
      if (user.isGM === true || owners.includes(user.id)) return true;
      if (level === 'OWNER') return false;
      if (level === 'LIMITED') return observers.includes(user.id) || limited.includes(user.id);
      return observers.includes(user.id);
    },
    toObject() {
      toObjectCalls.count += 1;
      const out: Record<string, unknown> = { _id: init.id, name: init.name, ...this.data };
      if (init.navName) out.navName = init.navName;
      for (const [coll, kids] of Object.entries(embedded))
        out[coll] = kids.map((k) => k.toObject());
      for (const [name, one] of Object.entries(singular)) out[name] = one.toObject();
      return out;
    },
  };
  Object.defineProperty(doc, '_source', {
    get() {
      return { _id: init.id, name: init.name, ...doc.data };
    },
  });
  Object.defineProperty(doc, 'schema', {
    get() {
      if (init.schemaReads) init.schemaReads.count += 1;
      return init.schema ? { fields: init.schema } : undefined;
    },
  });
  for (const [coll, kids] of Object.entries(embedded)) {
    doc[coll] = kids;
    for (const k of kids) k.parent = doc;
  }
  for (const [name, one] of Object.entries(singular)) {
    doc[name] = one;
    one.parent = doc;
  }
  return doc;
}

const collection = (docs: any[]) => ({
  contents: docs,
  get: (id: string) => docs.find((d) => d.id === id),
});

export interface WorldSetup {
  docs?: Record<string, any[]>;
  activeScene?: { documentName?: string; name: string; navName?: string };
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
    for (const key of Object.values<string>(d.constructor.metadata?.embedded ?? {})) {
      const value = d[key];
      if (!value) continue;
      for (const kid of Array.isArray(value) ? value : [value]) {
        kid.uuid = `${d.uuid}.${kid.documentName}.${kid.id}`;
        index(kid);
      }
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
