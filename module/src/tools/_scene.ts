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
export function version(doc: any): number {
  const value = doc?._stats?.modifiedTime;
  if (!Number.isFinite(value) || value < 0) forbid('Native document version is unavailable');
  return value;
}
