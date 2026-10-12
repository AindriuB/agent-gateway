/* eslint-disable @typescript-eslint/no-explicit-any */
import type { OpContext } from '../ops/types.js';
import { fromUuidCompat } from '../compat/index.js';
import { isAuditDocument } from '../audit/guard.js';
import { forbid, owns } from './_write.js';
import { gm, collection } from './_scene.js';
declare const game: any;
const roots: Record<string, string> = { RollTable: 'tables', Playlist: 'playlists' };
const children: Record<string, [string, string]> = {
  TableResult: ['RollTable', 'results'],
  PlaylistSound: ['Playlist', 'sounds'],
};
export function canonicalAmbience(doc: any): boolean {
  if (!doc || doc.pack || typeof doc.id !== 'string' || isAuditDocument(doc)) return false;
  const name = doc.documentName;
  if (Object.hasOwn(roots, name))
    return (
      !doc.parent && game[roots[name]!]?.get(doc.id) === doc && doc.uuid === `${name}.${doc.id}`
    );
  const relation = children[name];
  return (
    !!relation &&
    doc.parent?.documentName === relation[0] &&
    canonicalAmbience(doc.parent) &&
    doc.parent[relation[1]]?.get(doc.id) === doc &&
    doc.uuid === `${doc.parent.uuid}.${name}.${doc.id}`
  );
}
export function checkAmbience(ctx: OpContext, doc: any, type: string): any {
  const user = gm(ctx);
  if (doc?.documentName !== type || !canonicalAmbience(doc) || !owns(doc, user))
    forbid('A canonical GM-accessible ambience document is required');
  return doc;
}
export async function resolveAmbience(ctx: OpContext, uuid: string, type: string): Promise<any> {
  return checkAmbience(ctx, await fromUuidCompat(uuid), type);
}
/** Deterministic bounded native JSON; only optional undefined own object fields are omitted. */
export function ambienceSource(doc: any): string {
  let nodes = 0,
    bytes = 0;
  const seen = new WeakSet<object>();
  const text = (s: string) => {
    if (s.length > 65536 || (bytes += new TextEncoder().encode(s).length) > 65536)
      forbid('Native ambience source exceeds bounds');
  };
  const visit = (v: any, depth: number): any => {
    if (++nodes > 5000 || depth > 16) forbid('Native ambience source exceeds bounds');
    if (typeof v === 'string') {
      text(v);
      return v;
    }
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))
      return v;
    if (!v || typeof v !== 'object' || seen.has(v) || Object.getOwnPropertySymbols(v).length)
      forbid('Invalid native ambience JSON');
    seen.add(v);
    let out: any;
    if (Array.isArray(v)) {
      if (
        Object.getPrototypeOf(v) !== Array.prototype ||
        v.length > 5000 ||
        Object.keys(v).length !== v.length ||
        Object.getOwnPropertyNames(v).length !== v.length + 1
      )
        forbid('Invalid native ambience array');
      out = [];
      for (let i = 0; i < v.length; i++) {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d || !Object.hasOwn(d, 'value')) forbid('Native ambience accessors are unsupported');
        out.push(visit(d!.value, depth + 1));
      }
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(v)))
        forbid('Native ambience source must be plain data');
      const keys = Object.keys(v);
      if (keys.length > 5000) forbid('Native ambience source exceeds bounds');
      out = Object.create(null);
      for (const k of keys.sort()) {
        text(k);
        if (['__proto__', 'prototype', 'constructor'].includes(k))
          forbid('Unsafe native ambience key');
        const d = Object.getOwnPropertyDescriptor(v, k)!;
        if (!Object.hasOwn(d, 'value')) forbid('Native ambience accessors are unsupported');
        if (d.value === undefined) {
          if (++nodes > 5000) forbid('Native ambience source exceeds bounds');
          continue;
        }
        out[k] = visit(d.value, depth + 1);
      }
    }
    seen.delete(v);
    return out;
  };
  if (typeof doc.toObject !== 'function') forbid('Native ambience source unavailable');
  const source = doc.toObject();
  const identity =
    source && typeof source === 'object'
      ? Object.getOwnPropertyDescriptor(source, '_id')
      : undefined;
  if (!identity || !Object.hasOwn(identity, 'value') || identity.value !== doc.id)
    forbid('Native ambience source identity mismatch');
  const json = JSON.stringify(visit(source, 0));
  if (new TextEncoder().encode(json).length > 65536)
    forbid('Native ambience source exceeds bounds');
  return json;
}
export function ambienceStamp(doc: any): number {
  const stamp = doc?._stats?.modifiedTime;
  if (!Number.isFinite(stamp) || stamp < 0) forbid('Native ambience root version unavailable');
  return stamp;
}
export function captureAmbience(
  ctx: OpContext,
  root: any,
  childKey: 'results' | 'sounds',
): { rows: any[]; validate: () => void } {
  checkAmbience(ctx, root, root.documentName);
  const stamp = ambienceStamp(root),
    source = ambienceSource(root);
  const rows = [...collection(root[childKey], 100)];
  const type = childKey === 'results' ? 'TableResult' : 'PlaylistSound';
  const sources = rows.map((row) => {
    checkAmbience(ctx, row, type);
    return ambienceSource(row);
  });
  const validate = () => {
    checkAmbience(ctx, root, root.documentName);
    if (ambienceStamp(root) !== stamp || ambienceSource(root) !== source)
      forbid('Ambience document changed before action');
    const current = collection(root[childKey], 100);
    if (
      current.length !== rows.length ||
      rows.some(
        (row, i) =>
          !current.includes(row) ||
          row.parent !== root ||
          !canonicalAmbience(row) ||
          ambienceSource(row) !== sources[i],
      )
    )
      forbid('Ambience children changed before action');
  };
  validate();
  return { rows, validate };
}
