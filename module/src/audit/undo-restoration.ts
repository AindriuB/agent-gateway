/* eslint-disable @typescript-eslint/no-explicit-any */
import { isAuditDocument } from './guard.js';
import { AUDIT_LIMITS } from './types.js';
import { UNDO_EMBEDDED, undoClasses } from './undo-classes.js';

export interface RestorationDeps {
  isGM(): boolean;
  userId(): string;
  fromUuid(uuid: string): Promise<any>;
  canCreate(name: string): boolean;
  canModify(doc: any, action: 'update' | 'delete'): boolean;
  getClass(name: string): any;
}
interface Node {
  uuid: string;
  name: string;
  data: Record<string, any>;
  children: Node[];
  collections: string[];
}
/** A native call threw after dispatch: its persistence cannot safely be inferred. */
export class UncertainRestorationError extends Error {}

const plain = (v: any): boolean => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** Validate before serialization/construction, including ordinary system data. */
function bounded(value: unknown): void {
  const seen = new Set<object>();
  const pending = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { value: v, depth } = pending.pop()!;
    if (++count > 20_000 || depth > 32)
      throw Error('restoration snapshot exceeds traversal bounds');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') continue;
    if (typeof v === 'number' && Number.isFinite(v)) continue;
    if (!v || typeof v !== 'object' || (!Array.isArray(v) && !plain(v)))
      throw Error('invalid restoration snapshot value');
    if (seen.has(v)) throw Error('cyclic or aliased restoration snapshot');
    seen.add(v);
    for (const key in v) {
      if (!Object.hasOwn(v, key) || ['__proto__', 'constructor', 'prototype'].includes(key))
        throw Error('unsafe restoration snapshot key');
      if (pending.length + count >= 20_000) throw Error('restoration snapshot exceeds node bound');
      pending.push({ value: (v as any)[key], depth: depth + 1 });
    }
  }
  if (JSON.stringify(value).length > AUDIT_LIMITS.beforeChars)
    throw Error('restoration snapshot exceeds stored size bound');
}

function plan(uuid: string, data: Record<string, any>, deps: RestorationDeps): Node {
  bounded(data);
  let descendants = 0;
  const build = (uuid: string, data: Record<string, any>): Node => {
    const names = undoClasses(uuid);
    if (!names || !plain(data) || data._id !== uuid.split('.').at(-1))
      throw Error('invalid saved restoration identity');
    if (data.flags?.['agent-gateway']?.auditJournal === true || data.type === 'agent-gateway.audit')
      throw Error('protected audit snapshot cannot be restored');
    const cls = deps.getClass(names.own);
    if (!cls) throw Error('missing native restoration class');
    const metadata = cls.metadata?.embedded ?? {};
    if (!plain(metadata)) throw Error('invalid native embedded metadata');
    const children: Node[] = [];
    const collections: string[] = [];
    for (const [name, collection] of Object.entries(metadata)) {
      if (typeof collection !== 'string' || !collection || collections.includes(collection))
        throw Error('invalid native embedded collection');
      collections.push(collection);
      const values = data[collection];
      if (values === undefined) continue;
      if (!Array.isArray(values)) throw Error('invalid saved embedded collection');
      if (values.length && !UNDO_EMBEDDED.includes(name))
        throw Error('unsupported saved embedded class');
      const ids = new Set<string>();
      for (const value of values) {
        if (++descendants > 256) throw Error('too many saved embedded descendants');
        if (
          !plain(value) ||
          typeof value._id !== 'string' ||
          !/^[A-Za-z0-9_-]+$/.test(value._id) ||
          ids.has(value._id)
        )
          throw Error('invalid or duplicate saved embedded ID');
        ids.add(value._id);
        children.push(build(`${uuid}.${name}.${value._id}`, value));
      }
    }
    return { uuid, name: names.own, data, children, collections };
  };
  return build(uuid, data);
}

function ordinary(node: Node, source: any): unknown {
  const clean = (value: any): any => {
    if (Array.isArray(value)) return value.map(clean);
    if (!plain(value)) return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, clean(value[k])]),
    );
  };
  const out = { ...source };
  delete out._stats;
  for (const collection of node.collections) delete out[collection];
  return clean(out);
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Reconcile only missing saved descendants; never overwrite a colliding document. */
export async function restoreDeletedSubtree(
  uuid: string,
  before: Record<string, any>,
  existing: any,
  deps: RestorationDeps,
): Promise<void> {
  const root = plan(uuid, before, deps);
  const user = deps.userId();
  const authority = () => {
    if (!user || !deps.isGM() || deps.userId() !== user)
      throw Error('undo restoration authority lost');
  };
  const canonicalAncestry = (doc: any) => {
    for (let ancestor = doc, depth = 0; ancestor; ancestor = ancestor.parent) {
      if (
        ++depth > 32 ||
        ancestor.collection?.get?.(ancestor.id) !== ancestor ||
        isAuditDocument(ancestor)
      )
        throw Error('restoration canonical ancestry changed');
    }
  };
  const check = (node: Node, doc: any, parent: any) => {
    authority();
    if (
      !doc ||
      doc.uuid !== node.uuid ||
      doc.id !== node.data._id ||
      (doc.parent ?? null) !== parent ||
      isAuditDocument(doc)
    )
      throw Error('restoration identity or audit protection changed');
    canonicalAncestry(doc);
    if (doc.documentName !== node.name) throw Error('restoration native class changed');
    if (!deps.canModify(doc, 'update')) throw Error('not permitted to restore document');
    const source = doc.toObject();
    bounded(source);
    if (!equal(ordinary(node, source), ordinary(node, node.data)))
      throw Error('restored ordinary document data differs from saved snapshot');
  };
  const resolveExact = async (node: Node, doc: any, parent: any) => {
    const version = doc?._stats?.modifiedTime;
    const fresh = await deps.fromUuid(node.uuid);
    authority();
    if (fresh !== doc || doc?._stats?.modifiedTime !== version)
      throw Error('restoration document changed during lookup');
    check(node, fresh, parent);
    return fresh;
  };
  const collectionFor = (node: Node, doc: any, collection: string) => {
    const live = doc[collection];
    if (!live || !Array.isArray(live.contents) || typeof live.get !== 'function')
      throw Error('native embedded collection unavailable');
    const names = deps.getClass(node.name).metadata?.embedded ?? {};
    const saved = node.children.filter((child) => names[child.name] === collection);
    if (
      live.contents.some(
        (child: any) => live.get(child.id) !== child || !saved.some((s) => s.data._id === child.id),
      )
    )
      throw Error('unexpected or noncanonical embedded child prevents restoration');
    return { live, saved };
  };
  // No await inside this final scan: later sibling hooks cannot invalidate earlier proof.
  const verifyTree = (node: Node, doc: any, parent: any): void => {
    check(node, doc, parent);
    if (doc.documentName !== node.name) throw Error('restoration native class changed');
    for (const collection of node.collections) {
      const { live, saved } = collectionFor(node, doc, collection);
      if (
        !equal(
          live.contents.map((child: any) => child.id),
          saved.map((child) => child.data._id),
        )
      )
        throw Error('restored embedded identities or ordering differ');
      for (const child of saved) verifyTree(child, live.get(child.data._id), doc);
    }
  };
  const candidate = (node: Node, parent: any) => {
    authority();
    if (!deps.canModify(parent, 'update') || isAuditDocument(parent))
      throw Error('not permitted to restore into parent');
    const cls = deps.getClass(node.name);
    const data = JSON.parse(JSON.stringify(node.data));
    const value = cls.fromSource
      ? cls.fromSource(data, { parent, strict: true, creation: true })
      : new cls(data, { parent, strict: true, creation: true });
    if (
      value?.parent !== parent ||
      typeof value.canUserModify !== 'function' ||
      value.canUserModify((globalThis as any).game?.user, 'create', data) !== true
    )
      throw Error('native embedded create permission refused');
    canonicalAncestry(parent);
    authority();
    if (!deps.canModify(parent, 'update'))
      throw Error('parent permission changed during validation');
  };
  const mutate = async (operation: () => Promise<any>): Promise<any> => {
    authority();
    let value;
    try {
      value = await operation();
    } catch (cause) {
      throw new UncertainRestorationError(
        'native restoration outcome is uncertain; manual recovery required',
        { cause },
      );
    }
    authority();
    if (!value || (Array.isArray(value) && !value.length))
      throw Error('native restoration was vetoed');
    return value;
  };
  const reconcile = async (node: Node, doc: any, parent: any): Promise<void> => {
    await resolveExact(node, doc, parent);
    for (const collection of node.collections) collectionFor(node, doc, collection);
    for (const child of node.children) {
      const version = doc._stats?.modifiedTime;
      let current = await deps.fromUuid(child.uuid);
      authority();
      if (doc._stats?.modifiedTime !== version) throw Error('restoration parent version changed');
      await resolveExact(node, doc, parent);
      if (!current) {
        candidate(child, doc);
        const returned = await mutate(() =>
          doc.createEmbeddedDocuments(child.name, [JSON.parse(JSON.stringify(child.data))], {
            keepId: true,
            keepEmbeddedIds: true,
          }),
        );
        current = await deps.fromUuid(child.uuid);
        authority();
        if (!Array.isArray(returned) || returned.length !== 1 || returned[0] !== current)
          throw Error('native embedded return does not match canonical saved identity');
      }
      await reconcile(child, current, doc);
    }
    await resolveExact(node, doc, parent);
  };
  authority();
  let parent: any = null;
  if (uuid.split('.').length > 2) {
    parent = await deps.fromUuid(uuid.split('.').slice(0, -2).join('.'));
    authority();
    if (!parent || !Object.hasOwn(parent.constructor?.metadata?.embedded ?? {}, root.name))
      throw Error('canonical restoration parent missing');
  }
  if (!existing) {
    const cls = deps.getClass(root.name);
    if (parent) {
      const version = parent._stats?.modifiedTime;
      const canonical = await deps.fromUuid(parent.uuid);
      authority();
      if (canonical !== parent || parent._stats?.modifiedTime !== version)
        throw Error('restoration parent changed');
      candidate(root, parent);
      const returned = await mutate(() =>
        parent.createEmbeddedDocuments(root.name, [JSON.parse(JSON.stringify(before))], {
          keepId: true,
          keepEmbeddedIds: true,
        }),
      );
      existing = await deps.fromUuid(uuid);
      authority();
      if (!Array.isArray(returned) || returned.length !== 1 || returned[0] !== existing)
        throw Error('wrong embedded restoration result');
    } else {
      if (!deps.canCreate(root.name)) throw Error('not permitted to recreate root');
      const returned = await mutate(() =>
        cls.create(JSON.parse(JSON.stringify(before)), { keepId: true, keepEmbeddedIds: true }),
      );
      existing = await deps.fromUuid(uuid);
      authority();
      if (returned !== existing) throw Error('wrong root restoration result');
    }
  }
  await reconcile(root, existing, parent);
  await resolveExact(root, existing, parent);
  verifyTree(root, existing, parent);
}
