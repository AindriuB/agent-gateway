/* eslint-disable @typescript-eslint/no-explicit-any */
import { fromUuidCompat } from '../compat/index.js';
import { isAuditDocument } from '../audit/guard.js';
import { forbid, invalid, trustedUser, owns } from './_write.js';
import type { OpContext } from '../ops/types.js';
declare const game: any;
const roots: Record<string, string> = { Scene: 'scenes', Actor: 'actors', Combat: 'combats' };
const children: Record<string, [string, string]> = {
  Token: ['Scene', 'tokens'],
  Combatant: ['Combat', 'combatants'],
};
export function gm(ctx: OpContext): any {
  const user = trustedUser(ctx);
  if (user.isGM !== true) forbid('A current native GM is required');
  return user;
}
export function canonical(doc: any): boolean {
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
    canonical(doc.parent) &&
    doc.parent[relation[1]]?.get(doc.id) === doc &&
    doc.uuid === `${doc.parent.uuid}.${name}.${doc.id}`
  );
}
export function check(ctx: OpContext, doc: any, type: string): any {
  const user = gm(ctx);
  if (doc?.documentName !== type || !canonical(doc) || !owns(doc, user))
    forbid('A canonical GM-accessible world document is required');
  return doc;
}
export async function resolve(ctx: OpContext, uuid: string, type: string): Promise<any> {
  const doc = await fromUuidCompat(uuid);
  return check(ctx, doc, type);
}
export function collection(value: any, max = 1000): any[] {
  if (
    !Array.isArray(value?.contents) ||
    value.contents.length > max ||
    typeof value.get !== 'function'
  )
    forbid('A bounded complete native collection is required');
  const rows = value.contents;
  if (
    new Set(rows.map((d: any) => d.id)).size !== rows.length ||
    rows.some((d: any) => value.get(d.id) !== d)
  )
    forbid('Ambiguous native collection');
  return rows;
}
export function actionFields(
  args: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): void {
  const allowed = new Set(['action', ...required, ...optional]);
  if (
    required.some((key) => args[key] === undefined) ||
    Object.keys(args).some((key) => !allowed.has(key))
  )
    invalid('Arguments do not match the selected action');
}
export function footprint(scene: any, token: any, x: number, y: number): void {
  const r = scene.dimensions?.sceneRect;
  const size = token.getSize?.();
  if (
    !r ||
    !size ||
    ![r.x, r.y, r.width, r.height, size.width, size.height].every(Number.isFinite) ||
    r.width <= 0 ||
    r.height <= 0 ||
    size.width <= 0 ||
    size.height <= 0
  )
    forbid('Native scene rectangle or token footprint is unavailable');
  if (x < r.x || y < r.y || x + size.width > r.x + r.width || y + size.height > r.y + r.height)
    invalid('Token footprint must fit within the scene');
}
export function notInCombat(token: any): void {
  let count = 0;
  for (const combat of collection(game.combats)) {
    if (!canonical(combat)) forbid('Noncanonical encounter');
    for (const row of collection(combat.combatants)) {
      if (++count > 5000 || !canonical(row)) forbid('Combat references exceed supported bounds');
      if (row.token === token || (row.sceneId === token.parent.id && row.tokenId === token.id))
        forbid('Remove the token from every encounter first');
    }
  }
}
/** Native Tokens have no DocumentStatsField; bind their complete bounded source to the owning Scene. */
function tokenSource(doc: any): string {
  let nodes = 0,
    bytes = 0;
  const text = (value: string) => {
    if (value.length > 65536 || (bytes += new TextEncoder().encode(value).length) > 65536)
      forbid('Native token source exceeds supported bounds');
  };
  const seen = new WeakSet<object>();
  const visit = (value: any, depth: number): any => {
    if (++nodes > 5000 || depth > 16) forbid('Native token source exceeds supported bounds');
    if (typeof value === 'string') {
      text(value);
      return value;
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || seen.has(value))
      forbid('Native token source is not bounded JSON data');
    if (Object.getOwnPropertySymbols(value).length)
      forbid('Native token symbol keys are unsupported');
    seen.add(value);
    let result: any;
    if (Array.isArray(value)) {
      if (
        Object.getPrototypeOf(value) !== Array.prototype ||
        value.length > 5000 ||
        Object.keys(value).length !== value.length ||
        Object.getOwnPropertyNames(value).length !== value.length + 1
      )
        forbid('Sparse/oversized native token arrays are unsupported');
      const descriptors: PropertyDescriptor[] = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value'))
          forbid('Native token array accessors are unsupported');
        descriptors.push(descriptor!);
      }
      result = descriptors.map((descriptor) => visit(descriptor.value, depth + 1));
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        forbid('Native token source must contain plain objects');
      result = Object.create(null);
      const keys = Object.keys(value);
      if (keys.length > 5000) forbid('Native token source exceeds supported bounds');
      for (const key of keys.sort()) {
        text(key);
        if (['__proto__', 'prototype', 'constructor'].includes(key))
          forbid('Unsafe native token source key');
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!Object.hasOwn(descriptor, 'value')) forbid('Native token accessors are unsupported');
        // Native optional object fields are omitted by JSON snapshots; array entries remain strict.
        if (descriptor.value === undefined) {
          if (++nodes > 5000) forbid('Native token source exceeds supported bounds');
          continue;
        }
        result[key] = visit(descriptor.value, depth + 1);
      }
    }
    seen.delete(value);
    return result;
  };
  if (typeof doc.toObject !== 'function') forbid('Native token source is unavailable');
  const source = doc.toObject();
  const identity =
    source && typeof source === 'object'
      ? Object.getOwnPropertyDescriptor(source, '_id')
      : undefined;
  if (!identity || !Object.hasOwn(identity, 'value') || identity.value !== doc.id)
    forbid('Native token source identity mismatch');
  const json = JSON.stringify(visit(source, 0));
  if (new TextEncoder().encode(json).length > 65536)
    forbid('Native token source exceeds supported bounds');
  return json;
}
export function version(doc: any): number | string {
  if (doc?.documentName === 'Token') {
    if (!canonical(doc)) forbid('A canonical native Token and Scene are required');
    const parent = doc.parent;
    const stamp = parent?._stats?.modifiedTime;
    if (!Number.isFinite(stamp) || stamp < 0) forbid('Native parent Scene version is unavailable');
    const source = tokenSource(doc);
    if (doc.parent !== parent || !canonical(doc) || parent._stats?.modifiedTime !== stamp)
      forbid('Native Token/Scene changed during source capture');
    return `Token:${parent.uuid}:${stamp}:${source}`;
  }
  const value = doc?._stats?.modifiedTime;
  if (!Number.isFinite(value) || value < 0) forbid('Native document version is unavailable');
  return value;
}
