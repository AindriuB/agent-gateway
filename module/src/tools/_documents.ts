/* eslint-disable @typescript-eslint/no-explicit-any */
import { isAuditDocument } from '../audit/guard.js';
import { computeDiff, updatedDocument } from '../apps/approval/model.js';
import { forbid, invalid, owns, trustedUser, type WriteContext } from './_write.js';

declare const game: any;
declare const foundry: any;
declare const fromUuid: (uuid: string) => Promise<any>;

export const ROOTS = ['Actor', 'Item', 'JournalEntry'] as const;
const RELATIONS: Record<string, readonly string[]> = {
  Item: ['Actor'],
  ActiveEffect: ['Actor', 'Item'],
  JournalEntryPage: ['JournalEntry'],
};
const EMBEDDED: Record<string, Record<string, string>> = {
  Actor: { items: 'Item', effects: 'ActiveEffect' },
  Item: { effects: 'ActiveEffect' },
  JournalEntry: { pages: 'JournalEntryPage' },
};
const IDENTITIES = new Set([
  '_id',
  '_stats',
  'id',
  'uuid',
  'pack',
  'parent',
  'parentUuid',
  'collection',
  'documentName',
]);
const DANGEROUS = new Set(['__proto__', 'constructor', 'prototype']);
export const plain = (v: unknown): v is Record<string, any> =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));

/** Bound work before recursive native merging, diffing or serializing. */
export function bounded(value: unknown): void {
  const stack = [{ value, depth: 0 }];
  let count = 0;
  let bytes = 0;
  while (stack.length) {
    const { value: v, depth } = stack.pop()!;
    if (++count > 5000 || depth > 16) invalid('JSON exceeds structural bounds');
    if (typeof v === 'string') {
      if (v.length > 65536) invalid('JSON exceeds 64 KiB UTF-8');
      bytes += new TextEncoder().encode(v).length;
      if (bytes > 65536) invalid('JSON exceeds 64 KiB UTF-8');
    }
    if (typeof v === 'number' && !Number.isFinite(v)) invalid('JSON numbers must be finite');
    if (v && typeof v === 'object') {
      if (!Array.isArray(v) && !plain(v)) invalid('JSON objects must be plain');
      for (const k of Object.keys(v)) {
        bytes += new TextEncoder().encode(k).length;
        if (bytes > 65536) invalid('JSON exceeds 64 KiB UTF-8');
        if (k.split('.').some((part) => DANGEROUS.has(part.replace(/^-=/, ''))))
          invalid('Prototype paths are forbidden');
        if (stack.length + count >= 5000) invalid('JSON exceeds structural bounds');
        stack.push({ value: (v as any)[k], depth: depth + 1 });
      }
    }
  }
}
export function parseData(raw: string): Record<string, any> {
  if (new TextEncoder().encode(raw).length > 65536) invalid('JSON exceeds 64 KiB UTF-8');
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    invalid('Invalid JSON');
  }
  if (!plain(data)) invalid('A JSON object is required');
  bounded(data);
  return data as Record<string, any>;
}
export function gm(ctx: WriteContext): any {
  const user = trustedUser(ctx);
  if (user.isGM !== true) forbid('A current native GM is required');
  return user;
}
export function documentClass(type: string): any {
  if (!ROOTS.includes(type as any) && !Object.hasOwn(RELATIONS, type))
    forbid('Unsupported document class');
  const cls = foundry.utils.getDocumentClass(type);
  if (cls?.documentName !== type) forbid('Native document class is unavailable');
  return cls;
}
/** Actual object identity in every native collection, not just a matching UUID string. */
export function canonical(doc: any, seen = new Set<any>()): boolean {
  if (!doc || doc.pack || seen.has(doc) || seen.size >= 4 || typeof doc.id !== 'string')
    return false;
  seen.add(doc);
  const name = doc.documentName;
  if (doc.parent) {
    const parent = doc.parent;
    if (!RELATIONS[name]?.includes(parent.documentName) || !canonical(parent, seen)) return false;
    return (
      doc.uuid === `${parent.uuid}.${name}.${doc.id}` &&
      parent.getEmbeddedCollection?.(name)?.get(doc.id) === doc
    );
  }
  return (
    ROOTS.includes(name) &&
    doc.uuid === `${name}.${doc.id}` &&
    game.collections?.get(name)?.get(doc.id) === doc
  );
}
export function checkDocument(
  ctx: WriteContext,
  doc: any,
  action: 'update' | 'delete' = 'update',
): void {
  const user = gm(ctx);
  if (
    !canonical(doc) ||
    isAuditDocument(doc) ||
    !owns(doc, user) ||
    doc.canUserModify?.(user, action) !== true
  )
    forbid('A canonical permitted world document is required');
  if (doc.documentName === 'JournalEntryPage' && doc.type === 'agent-gateway.audit')
    forbid('Audit page subtype is protected');
  if (doc.documentName === 'JournalEntry') {
    const pages = doc.getEmbeddedCollection?.('JournalEntryPage');
    const entries = pages?.contents ?? (pages ? [...pages.values()] : []);
    if (entries.length > 5000 || entries.some((page: any) => page.type === 'agent-gateway.audit'))
      forbid('Protected audit pages cannot be changed through their journal');
  }
  for (let parent = doc.parent; parent; parent = parent.parent)
    if (!owns(parent, user) || parent.canUserModify?.(user, 'update') !== true) forbid();
}
export async function resolveDocument(
  ctx: WriteContext,
  uuid: string,
  action: 'update' | 'delete' = 'update',
): Promise<any> {
  const doc = await fromUuid(uuid);
  checkDocument(ctx, doc, action);
  if (doc.uuid !== uuid) forbid('A canonical UUID is required');
  return doc;
}
export function checkFolder(ctx: WriteContext, folder: any, type: string): void {
  const user = gm(ctx);
  if (
    !folder ||
    folder.pack ||
    folder.parent ||
    folder.documentName !== 'Folder' ||
    folder.type !== type ||
    game.folders?.get(folder.id) !== folder ||
    !owns(folder, user)
  )
    forbid('A matching canonical world folder is required');
}
export async function resolveFolder(
  ctx: WriteContext,
  id: string | undefined,
  type: string,
): Promise<any> {
  if (!id) return undefined;
  const folder = game.folders?.get(id);
  checkFolder(ctx, folder, type);
  return folder;
}
export function checkCreate(
  ctx: WriteContext,
  type: string,
  data: Record<string, any>,
  parent?: any,
  folder?: any,
): any {
  const user = gm(ctx);
  const cls = documentClass(type);
  if (parent) {
    checkDocument(ctx, parent);
    if (!RELATIONS[type]?.includes(parent.documentName) || folder)
      forbid('Unsupported embedded parent');
    // The inherited UI affordance builds a blank strict sample, which can fail
    // required embedded fields. Check this actual validated request and parent instead.
    let candidate;
    try {
      candidate = cls.fromSource(structuredClone(data), { parent, strict: true, creation: true });
    } catch {
      invalid('Creation data does not satisfy the native document schema');
    }
    if (
      candidate?.documentName !== type ||
      candidate.parent !== parent ||
      candidate.canUserModify?.(user, 'create', data) !== true
    )
      forbid('Native create permission is required');
  } else {
    if (!ROOTS.includes(type as any)) forbid('An embedded parent is required');
    if (cls.canUserCreate?.(user) !== true) forbid('Native create permission is required');
  }
  if (folder) checkFolder(ctx, folder, type);
  gm(ctx);
  return cls;
}
/** Validate document-level fields separately from raw system/custom-flag data. */
export function checkData(
  data: Record<string, any>,
  type: string,
  update = false,
  imported = false,
): void {
  bounded(data);
  const walk = (patch: Record<string, any>, prefix = ''): void => {
    for (const [key, value] of Object.entries(patch)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const parts = path.split('.').map((p) => p.replace(/^-=/, ''));
      if (!update && path.split('.').some((p) => p.startsWith('-=')))
        invalid('Creation data cannot contain deletion paths');
      if (IDENTITIES.has(parts[0]!) && !(imported && ['_id', '_stats'].includes(parts[0]!)))
        invalid('Document identity and version fields are immutable');
      const flagsAt = parts.indexOf('flags');
      if (flagsAt !== -1) {
        if (
          path.split('.')[flagsAt]!.startsWith('-=') ||
          parts.slice(flagsAt + 1).includes('agent-gateway') ||
          (parts.length === flagsAt + 1 && (key.startsWith('-=') || !plain(value)))
        )
          invalid('Reserved metadata cannot be changed');
      }
      if (parts[0] === 'type' && value === 'agent-gateway.audit')
        forbid('Audit page subtype is protected');
      const childType = EMBEDDED[type]?.[parts[0]!];
      if (childType) {
        // Native embedded arrays are allowed; dotted/deletion collection edits are ambiguous and refused.
        if (parts.length !== 1 || key.startsWith('-=') || !Array.isArray(value))
          invalid('Embedded collections require native document arrays');
        for (const child of value) {
          if (!plain(child)) invalid('Embedded data must be objects');
          checkData(child, childType, update, imported);
        }
        continue;
      }
      const nativeEmbedded = documentClass(type).metadata?.embedded ?? {};
      if (Object.values(nativeEmbedded).includes(parts[0]!))
        forbid('Unsupported embedded collection');
      const visit = (child: unknown, childPath: string): void => {
        if (plain(child)) walk(child, childPath);
        else if (Array.isArray(child))
          child.forEach((item, index) => visit(item, `${childPath}.${index}`));
      };
      visit(value, path);
    }
  };
  walk(data);
  if (!update && Object.hasOwn(data, 'folder')) invalid('Use the explicit folder argument');
}
export function preview(doc: any, changes: Record<string, any>): void {
  try {
    const before = doc.toObject();
    const after = updatedDocument(before, changes);
    computeDiff(before, after);
    // Removing an ancestor must not erase reserved metadata hidden below that ancestor.
    const pending: Array<{ before: any; after: any }> = [{ before, after }];
    while (pending.length) {
      const { before: old, after: next } = pending.pop()!;
      if (!old || typeof old !== 'object') continue;
      if (
        plain(old.flags) &&
        Object.hasOwn(old.flags, 'agent-gateway') &&
        JSON.stringify(old.flags['agent-gateway']) !==
          JSON.stringify(next?.flags?.['agent-gateway'])
      )
        invalid('Reserved metadata must survive updates');
      for (const key of Object.keys(old))
        if (old[key] && typeof old[key] === 'object')
          pending.push({ before: old[key], after: next?.[key] });
    }
  } catch {
    invalid('A bounded before/after approval diff is required');
  }
}
export function successful(doc: any, result: any): void {
  if (result !== doc || !canonical(doc))
    throw new Error('Native mutation was cancelled or returned no canonical document');
}
export async function createDocument(
  ctx: WriteContext,
  type: string,
  data: Record<string, any>,
  parent?: any,
  folder?: any,
  imported = false,
  beforeCreate?: () => void,
): Promise<string> {
  checkData(data, type, false, imported);
  const createData = { ...data, ...(folder ? { folder: folder.id } : {}) };
  checkCreate(ctx, type, createData, parent, folder);
  await ctx.intendCreate(parent);
  // Recheck object identity and native authorization after the awaited audit intent.
  beforeCreate?.();
  const cls = checkCreate(ctx, type, createData, parent, folder);
  const made = parent
    ? (await parent.createEmbeddedDocuments(type, [data], ctx.callOptions))?.[0]
    : await cls.create(createData, ctx.callOptions);
  if (
    !canonical(made) ||
    made.documentName !== type ||
    (made.parent ?? undefined) !== parent ||
    isAuditDocument(made)
  )
    throw new Error('Native creation returned no canonical new document');
  await ctx.created(made.uuid, parent);
  return made.uuid;
}
