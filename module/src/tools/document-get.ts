/* eslint-disable @typescript-eslint/no-explicit-any */
import { fromUuidCompat } from '../compat/index.js';
import { folderAllowed } from '../policy/folders.js';
import type { DispatchResult, OpHandler } from '../ops/types.js';
import {
  domToDocument,
  inlineText,
  page,
  PageCursorError,
  serialiseDocument,
  stripSecrets,
  includeOtherModuleDataSetting,
  type MdDocument,
} from '../serialise/index.js';
import {
  applyTree,
  findNode,
  pathMatches,
  presentedName,
  rootVisible,
  treeStamp,
  visibleTree,
  type DocContext,
  type VisibleNode,
} from './visibility.js';

declare const game: any;

/** World document types this tool reads; their embedded documents come with them. */
export const READABLE_TYPES = [
  'Actor',
  'Item',
  'JournalEntry',
  'Scene',
  'RollTable',
  'Macro',
  'Playlist',
] as const;

const looksLikeHtml = (s: string) => /<\/?[a-z][^>]*>/i.test(s);

/**
 * The serialised document as one markdown document: a heading plus the converted value per HTML
 * field, a fenced block per code field, a `path: value` line per other field. Built through the
 * DOM so nothing is spliced into other markup. Secret sections are dropped from HTML fields unless
 * the user owns the document that holds the field.
 */
export function toMdDocument(
  data: Record<string, unknown>,
  contexts: Map<object, DocContext>,
): MdDocument {
  const dom = new DOMParser().parseFromString('', 'text/html');
  const el = (tag: string, text?: string) => {
    const e = dom.createElement(tag);
    if (text !== undefined) e.textContent = text;
    return e;
  };
  interface Item {
    path: string;
    rel: string;
    value: unknown;
    ctx: DocContext | undefined;
  }
  const stack: Item[] = [{ path: '', rel: '', value: data, ctx: undefined }];
  const join = (a: string, k: string) => (a ? `${a}.${k}` : k);
  while (stack.length) {
    const { path, rel, value, ctx: outer } = stack.pop()!;
    let ctx = outer;
    let here = rel;
    if (value && typeof value === 'object' && contexts.has(value)) {
      ctx = contexts.get(value);
      here = '';
    }
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) {
        stack.push({ path: `${path}[${i}]`, rel: `${here}[*]`, value: value[i], ctx });
      }
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value).reverse()) {
        stack.push({ path: join(path, k), rel: join(here, k), value: v, ctx });
      }
    } else if (typeof value === 'string') {
      if (value === '') continue;
      const schemaHtml = ctx?.html ? pathMatches(ctx.html, here) : false;
      const isCode =
        ctx !== undefined && (pathMatches(ctx.code, here) || (ctx.isMacro && here === 'command'));
      const markup = looksLikeHtml(value);
      // The schema only decides how a field is shown. Secrets go from every string that holds
      // markup, wherever it sits, unless the reader owns the document: the schema may be missing
      // (template.json systems), wrong, or not cover a mapping or a flag.
      const needsStrip = !ctx?.owner && markup && !isCode;
      const asHtml = schemaHtml || (ctx?.html == null && markup && !isCode);
      let text = value;
      let box: HTMLElement | undefined;
      if (asHtml || needsStrip) {
        box = el('div');
        box.innerHTML = value;
        if (needsStrip) stripSecrets(box);
        if (!asHtml) text = box.innerHTML;
      }
      if (asHtml && box) {
        dom.body.append(el('h3', path));
        dom.body.append(box);
      } else if (isCode) {
        dom.body.append(el('p', path));
        const pre = el('pre');
        pre.append(el('code', value));
        dom.body.append(pre);
      } else {
        const p = el('p');
        p.append(el('strong', path), dom.createTextNode(': '));
        text.split(/\r\n?|\n/).forEach((line, i) => {
          if (i > 0) p.append(el('br'));
          p.append(dom.createTextNode(line));
        });
        dom.body.append(p);
      }
    } else if (value !== null && value !== undefined) {
      const p = el('p');
      p.append(el('strong', path), dom.createTextNode(`: ${String(value)}`));
      dom.body.append(p);
    }
  }
  return domToDocument(dom.body);
}

const err = (message: string): DispatchResult => ({ error: { code: 'INVALID_ARGS', message } });
const notFound = (uuid: string) => err(`Document "${uuid}" not found`);

/** Built documents, so paging does not re-serialise. Bounded by entry count and total size. */
const CACHE_MAX_ENTRIES = 8;
const CACHE_MAX_SIZE = 4_000_000;
const cache = new Map<string, { md: MdDocument; size: number }>();

const sizeOf = (md: MdDocument): number =>
  md.blocks.reduce((n, b) => b.segs.reduce((m, s) => m + s.md.length, n) + 16, 0);

function cacheGet(key: string): MdDocument | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  cache.delete(key);
  cache.set(key, hit);
  return hit.md;
}

function cachePut(key: string, md: MdDocument): void {
  const size = sizeOf(md) + key.length;
  if (size > CACHE_MAX_SIZE) return;
  cache.set(key, { md, size });
  let total = 0;
  for (const e of cache.values()) total += e.size;
  for (const k of cache.keys()) {
    if (cache.size <= CACHE_MAX_ENTRIES && total <= CACHE_MAX_SIZE) break;
    total -= cache.get(k)!.size;
    cache.delete(k);
  }
}

/** Test hook: forget every cached document. */
export function clearDocumentCache(): void {
  cache.clear();
}

/**
 * The visible-document tree for the world document at the top of `doc`'s ancestry, and the node for
 * `doc` within it; undefined unless the user may observe the root and every step down to `doc`
 * survives the embedded-visibility rules.
 */
function readable(doc: any, user: any): VisibleNode | undefined {
  let root = doc;
  while (root.parent) root = root.parent;
  // Outside the GM's folder allowlist reads as missing, same as a hidden document (never FORBIDDEN,
  // which would confirm it exists). Checked on the root so embedded uuids agree with search.
  if (!folderAllowed(root, user.isGM === true)) return undefined;
  if (
    user.isGM !== true &&
    (!(
      typeof root.testUserPermission === 'function' && root.testUserPermission(user, 'OBSERVER')
    ) ||
      !rootVisible(root, user))
  )
    return undefined;
  return findNode(visibleTree(root, user), doc);
}

export const documentGetHandler: OpHandler = async (ctx) => {
  const { uuid, cursor } = ctx.args as { uuid: string; cursor?: string };
  if (uuid.startsWith('Compendium.')) {
    return err('Compendium documents are not read here; use compendium_get');
  }
  if (!(READABLE_TYPES as readonly string[]).includes(uuid.split('.')[0]!)) {
    return err(`document_get reads ${READABLE_TYPES.join(', ')} documents only`);
  }
  let doc: any = null;
  try {
    doc = await fromUuidCompat(uuid);
  } catch {
    doc = null;
  }
  const user = game.users.get(ctx.user.id);
  // A document the user cannot observe looks exactly like a missing one, so uuids cannot be probed.
  const tree = !doc || !user || doc.pack ? undefined : readable(doc, user);
  if (!tree) return notFound(uuid);

  const optIn = includeOtherModuleDataSetting();
  const key = [doc.uuid ?? uuid, user.id, user.role, optIn, treeStamp(tree)].join('|');
  let md = cacheGet(key);
  if (!md) {
    const data = serialiseDocument(doc) as Record<string, any>;
    const contexts = new Map<object, DocContext>();
    applyTree(tree, data, contexts);
    md = toMdDocument(data, contexts);
    cachePut(key, md);
  }
  let result;
  try {
    result = page(md, cursor);
  } catch (e) {
    if (!(e instanceof PageCursorError)) throw e;
    const issued = cursor ? /^p1\.([0-9a-f]{8})\./.exec(cursor) : null;
    return err(
      issued && issued[1] !== md.id
        ? 'The document changed since this cursor was issued; call again without a cursor to restart'
        : 'Invalid page cursor',
    );
  }
  const name = presentedName(doc, user);
  const type = String(doc.documentName ?? doc.constructor?.documentName ?? '');
  const structured: Record<string, unknown> = {
    uuid: String(doc.uuid ?? uuid),
    name,
    type,
    content: result.chunk,
  };
  if (result.nextCursor) structured.nextCursor = result.nextCursor;
  const more = result.nextCursor ? `\n\n[more: call again with cursor "${result.nextCursor}"]` : '';
  const head = `${inlineText(type)}: ${inlineText(name)} (${inlineText(String(structured.uuid))})`;
  return { text: `${head}\n\n${result.chunk}${more}`, structured };
};
