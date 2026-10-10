/* eslint-disable @typescript-eslint/no-explicit-any */
import { compendiumGet } from '@agent-gateway/protocol';
import type { OpError, OpHandler } from '../ops/types.js';
import { fromUuidCompat } from '../compat/index.js';
import { inlineText, page, PageCursorError, serialiseDocument } from '../serialise/index.js';
import { canObservePack } from './compendium-search.js';
import { toMdDocument } from './document-get.js';
import { applyTree, findNode, presentedName, visibleTree, type DocContext } from './visibility.js';

declare const game: any;

const fail = (message: string): OpError => ({ error: { code: 'INVALID_ARGS', message } });

export const compendiumGetHandler: OpHandler = async (ctx) => {
  const { uuid, cursor } = compendiumGet.input.parse(ctx.args);
  const parts = uuid.split('.');
  if (parts[0] !== 'Compendium' || parts.length < 5) {
    return fail('Not a compendium entry UUID (expected Compendium.<scope>.<pack>.<Type>.<id>).');
  }
  const packId = `${parts[1]}.${parts[2]}`;
  const pack = game.packs.get(packId);
  // Checked before anything is loaded; the answer is the same as for a missing pack.
  if (!pack || !canObservePack(pack, ctx.user.id)) return fail('Compendium entry not found.');
  let doc: any = null;
  try {
    doc = await fromUuidCompat(uuid);
  } catch {
    doc = null;
  }
  const user = game.users.get(ctx.user.id);
  let root = doc;
  while (root?.parent) root = root.parent;
  // The pack gate above replaces the world-document root rules; embedded rules still apply.
  const tree = doc && user ? findNode(visibleTree(root, user), doc) : undefined;
  if (!tree) return fail('Compendium entry not found.');

  // The same pipeline as document_get: visibility, field rules, secrets, schema-typed fields.
  const data = serialiseDocument(doc) as Record<string, any>;
  const contexts = new Map<object, DocContext>();
  applyTree(tree, data, contexts);
  const mdDoc = toMdDocument(data, contexts);
  const name = presentedName(doc, user);
  const type = String(doc.documentName ?? parts[3]);
  let result;
  try {
    result = page(mdDoc, cursor);
  } catch (err) {
    if (err instanceof PageCursorError) return fail('Invalid page cursor for this entry.');
    throw err;
  }
  const structured: Record<string, unknown> = {
    uuid,
    name,
    type,
    pack: packId,
    markdown: result.chunk,
  };
  if (result.nextCursor) structured.nextCursor = result.nextCursor;
  const header = `${inlineText(name)} (${inlineText(type)}, ${inlineText(packId)})`;
  return {
    text: `${header}\n\n${result.chunk}${result.nextCursor ? `\n\n(more: cursor ${result.nextCursor})` : ''}`,
    structured,
  };
};
