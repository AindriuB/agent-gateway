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

declare const foundry: any;

type Kind = 'html' | 'text' | 'code';
interface Chunk {
  kind: Kind;
  value: string;
}

const getPath = (obj: any, path: string): unknown =>
  path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);

/**
 * The text fields of an entry, in reading order. Whether a value is HTML is decided by the data model
 * (an `HTMLField`), never by what the value looks like: a plain string field is escaped even if it
 * contains tags. A path the model does not define is skipped. Values come from the flag-filtered
 * serialised data; only the schema is read from the live documents.
 */
function collect(doc: any, data: any): Chunk[] {
  const out: Chunk[] = [];
  const HTMLField = foundry?.data?.fields?.HTMLField;
  const take = (owner: any, src: any, path: string, as?: Kind) => {
    const v = getPath(src, path);
    if (typeof v !== 'string' || !v.trim()) return;
    const field = owner?.schema?.getField?.(path);
    if (!field) return;
    out.push({ kind: as ?? (HTMLField && field instanceof HTMLField ? 'html' : 'text'), value: v });
  };
  for (const path of [
    'system.description.value',
    'system.description',
    'system.details.biography.value',
    'description',
    'content',
  ]) {
    take(doc, data, path);
  }
  take(doc, data, 'command', 'code');
  // Embedded documents, each judged by its own data model: journal pages, table results, scene notes.
  const embedded: Array<[string, string[]]> = [
    ['pages', ['text.content']],
    ['results', ['description', 'text']],
    ['notes', ['text']],
  ];
  for (const [collection, paths] of embedded) {
    for (const item of Array.isArray(data?.[collection]) ? data[collection] : []) {
      const owner = doc?.[collection]?.get?.(item?._id);
      for (const path of paths) take(owner, item, path);
    }
  }
  return out;
}

/** Entry name, then each text field, built in an inert document and converted. */
function entryToDocument(doc: any, data: any, fallbackName: string): MdDocument {
  const inert = new DOMParser().parseFromString('', 'text/html');
  const h = inert.createElement('h1');
  h.textContent = String(data?.name ?? fallbackName);
  inert.body.append(h);
  for (const { kind, value } of collect(doc, data)) {
    if (kind === 'html') {
      const section = inert.createElement('div');
      // Inert document: nothing loads or runs. The converter treats the result as untrusted.
      section.innerHTML = value;
      inert.body.append(section);
    } else if (kind === 'code') {
      const pre = inert.createElement('pre');
      const code = inert.createElement('code');
      code.textContent = value;
      pre.append(code);
      inert.body.append(pre);
    } else {
      const p = inert.createElement('p');
      p.textContent = value;
      inert.body.append(p);
    }
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
  const mdDoc = entryToDocument(doc, data, name);
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
