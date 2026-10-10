/* eslint-disable @typescript-eslint/no-explicit-any */
import { compendiumGet } from '@agent-gateway/protocol';
import type { OpError, OpHandler } from '../ops/types.js';
import {
  domToDocument,
  page,
  PageCursorError,
  serialiseDocument,
  type MdDocument,
} from '../serialise/index.js';
import { canObservePack, inlineText } from './compendium-search.js';

declare const game: any;
declare function fromUuid(uuid: string): Promise<any>;

/** Rich-text (HTML) fields of a serialised entry, in reading order. */
function richText(data: any): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) out.push(v);
  };
  add(data?.system?.description?.value);
  add(data?.system?.description);
  add(data?.system?.details?.biography?.value);
  add(data?.description);
  add(data?.content);
  for (const p of Array.isArray(data?.pages) ? data.pages : []) {
    add(p?.text?.content);
  }
  return out;
}

/** Entry name, then each rich-text field, parsed in an inert document and converted. */
function entryToDocument(data: any, fallbackName: string): MdDocument {
  const inert = new DOMParser().parseFromString('', 'text/html');
  const h = inert.createElement('h1');
  h.textContent = String(data?.name ?? fallbackName);
  inert.body.append(h);
  for (const html of richText(data)) {
    const section = inert.createElement('div');
    // Inert document: nothing loads or runs. The converter treats the result as untrusted.
    section.innerHTML = html;
    inert.body.append(section);
  }
  return domToDocument(inert.body);
}

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
  const doc = await fromUuid(uuid);
  if (!doc) return fail('Compendium entry not found.');

  const data = serialiseDocument(doc);
  const name = String(data.name ?? doc.name ?? '');
  const type = String(doc.documentName ?? parts[3]);
  const mdDoc = entryToDocument(data, name);
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
