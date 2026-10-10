/* eslint-disable @typescript-eslint/no-explicit-any */
import { fromUuidCompat } from '../compat/index.js';
import type { OpError, OpHandler, OpResult } from '../ops/types.js';
import {
  domToDocument,
  page,
  PageCursorError,
  serialiseDocument,
  type MdDocument,
} from '../serialise/index.js';

declare const game: any;

const looksLikeHtml = (s: string) => /<\/?[a-z][^>]*>/i.test(s);

/**
 * The serialised document as one markdown document: a heading plus raw value per HTML field,
 * a `path: value` line per other field. Built through the DOM so HTML is never spliced into
 * other markup, and flags are already filtered by `serialiseDocument`.
 */
function toMdDocument(data: Record<string, unknown>): MdDocument {
  const dom = new DOMParser().parseFromString('', 'text/html');
  const el = (tag: string, text?: string) => {
    const e = dom.createElement(tag);
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const stack: Array<[string, unknown]> = Object.entries(data).reverse();
  while (stack.length) {
    const [path, value] = stack.pop()!;
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) stack.push([`${path}[${i}]`, value[i]]);
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value).reverse()) stack.push([`${path}.${k}`, v]);
    } else if (typeof value === 'string' && looksLikeHtml(value)) {
      dom.body.append(el('h3', path));
      const box = el('div');
      box.innerHTML = value;
      dom.body.append(box);
    } else if (value !== null && value !== '' && value !== undefined) {
      const p = el('p');
      p.append(el('strong', path), dom.createTextNode(`: ${String(value)}`));
      dom.body.append(p);
    }
  }
  return domToDocument(dom.body);
}

/** Handlers return failures as `{ error }`, which the dispatcher passes through as it does a stage's. */
const failure = (code: OpError['error']['code'], message: string): OpResult =>
  ({ error: { code, message } }) as unknown as OpResult;

export const documentGetHandler: OpHandler = async (ctx) => {
  const { uuid, cursor } = ctx.args as { uuid: string; cursor?: string };
  let doc: any = null;
  try {
    doc = await fromUuidCompat(uuid);
  } catch {
    doc = null;
  }
  if (!doc || typeof doc.testUserPermission !== 'function') {
    return failure('INVALID_ARGS', `Document "${uuid}" not found`);
  }
  const user = game.users.get(ctx.user.id);
  if (!user || !doc.testUserPermission(user, 'OBSERVER')) {
    return failure('FORBIDDEN', `You may not view document "${uuid}"`);
  }
  let result;
  try {
    result = page(toMdDocument(serialiseDocument(doc)), cursor);
  } catch (err) {
    if (err instanceof PageCursorError) return failure('INVALID_ARGS', 'Invalid page cursor');
    throw err;
  }
  const name = String(doc.name ?? '');
  const type = String(doc.documentName ?? doc.constructor?.documentName ?? '');
  const structured: Record<string, unknown> = {
    uuid: String(doc.uuid ?? uuid),
    name,
    type,
    content: result.chunk,
  };
  if (result.nextCursor) structured.nextCursor = result.nextCursor;
  const more = result.nextCursor ? `\n\n[more: call again with cursor "${result.nextCursor}"]` : '';
  return { text: `${type} "${name}" (${structured.uuid})\n\n${result.chunk}${more}`, structured };
};
