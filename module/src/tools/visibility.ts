/* eslint-disable @typescript-eslint/no-explicit-any */
declare const foundry: any;

/** What the requesting user may see of one document and, recursively, its embedded documents. */
export interface VisibleNode {
  doc: any;
  /** The user owns this document, so its HTML secrets are shown. */
  owner: boolean;
  /** Embedded collection name to the embedded documents the user may see. */
  children: Record<string, VisibleNode[]>;
}

/** Names of a document class's embedded collections (`pages`, `tokens`, `items`, ...). */
function embeddedCollections(doc: any): string[] {
  const meta = doc?.constructor?.metadata?.embedded;
  if (meta && typeof meta === 'object') return Object.values(meta).map(String);
  const hierarchy = doc?.constructor?.hierarchy;
  if (hierarchy && typeof hierarchy === 'object') return Object.keys(hierarchy);
  return [];
}

const listOf = (collection: any): any[] =>
  Array.from(collection?.contents ?? collection ?? []) as any[];

const hasOwnership = (doc: any): boolean =>
  doc?._source !== undefined && doc._source !== null && 'ownership' in doc._source;

/**
 * May a non-GM user see this embedded document? Foundry's own rules, evaluated for `user`, not
 * `game.user`: hidden tokens, tiles and drawings are GM-only; documents with an ownership field
 * (journal pages) need OBSERVER; a map note shows only if its journal entry is observable.
 * A document that cannot be judged is excluded.
 */
function embeddedVisible(doc: any, user: any): boolean {
  if (doc.hidden === true) return false;
  if (doc.documentName === 'Note') {
    const entry = doc.entry ?? doc.page?.parent;
    return typeof entry?.testUserPermission === 'function'
      ? entry.testUserPermission(user, 'OBSERVER') === true
      : false;
  }
  if (hasOwnership(doc)) {
    return typeof doc.testUserPermission === 'function'
      ? doc.testUserPermission(user, 'OBSERVER') === true
      : false;
  }
  return true;
}

/** The documents `user` may read below (and including) `doc`; the caller already checked `doc` itself. */
export function visibleTree(doc: any, user: any): VisibleNode {
  const gm = user?.isGM === true;
  const node: VisibleNode = {
    doc,
    owner:
      gm ||
      (typeof doc.testUserPermission === 'function' &&
        doc.testUserPermission(user, 'OWNER') === true),
    children: {},
  };
  for (const name of embeddedCollections(doc)) {
    node.children[name] = listOf(doc[name])
      .filter((e) => gm || embeddedVisible(e, user))
      .map((e) => visibleTree(e, user));
  }
  return node;
}

/** A string that changes whenever a visible document changes; null if any lacks a modified time. */
export function treeStamp(node: VisibleNode): string | null {
  const t = node.doc._stats?.modifiedTime;
  if (t === undefined || t === null) return null;
  let out = `${node.doc.id}:${t}${node.owner ? 'o' : ''}`;
  for (const [name, kids] of Object.entries(node.children)) {
    const parts: string[] = [];
    for (const k of kids) {
      const s = treeStamp(k);
      if (s === null) return null;
      parts.push(s);
    }
    out += `|${name}[${parts.join(',')}]`;
  }
  return out;
}

/** What is known about one serialised document object while walking its data. */
export interface DocContext {
  owner: boolean;
  /** HTML field paths relative to the document, array indexes as `[*]`; null when the schema is unknown. */
  html: Set<string> | null;
  code: Set<string>;
  isMacro: boolean;
}

/**
 * Remove from `data` every embedded document not in `tree` (recursively), and register each remaining
 * document object, root included, in `contexts`.
 */
export function applyTree(
  tree: VisibleNode,
  data: Record<string, any>,
  contexts: Map<object, DocContext>,
): void {
  const html = new Set<string>();
  const code = new Set<string>();
  const known = collectFields(tree.doc, html, code);
  contexts.set(data, {
    owner: tree.owner,
    html: known ? html : null,
    code,
    isMacro: tree.doc.documentName === 'Macro',
  });
  for (const [name, kids] of Object.entries(tree.children)) {
    const items = data[name];
    if (!Array.isArray(items)) continue;
    const byId = new Map(kids.map((k) => [String(k.doc.id ?? k.doc._id), k]));
    data[name] = items.filter((item) => {
      const kid = byId.get(String(item?._id));
      if (!kid) return false;
      applyTree(kid, item, contexts);
      return true;
    });
  }
}

/** Fill `html`/`code` with the field paths of `doc`'s schema; false if the schema is not available. */
function collectFields(doc: any, html: Set<string>, code: Set<string>): boolean {
  const fields = doc?.schema?.fields;
  if (!fields || typeof fields !== 'object') return false;
  const F = foundry?.data?.fields ?? {};
  const isHtml = (f: any) => typeof F.HTMLField === 'function' && f instanceof F.HTMLField;
  const isCode = (f: any) =>
    typeof F.JavaScriptField === 'function' && f instanceof F.JavaScriptField;
  const visit = (field: any, path: string, depth: number): void => {
    if (!field || depth > 12) return;
    if (isHtml(field)) html.add(path);
    else if (isCode(field)) code.add(path);
    else if (path === 'system' && doc.system?.schema?.fields) {
      for (const [k, f] of Object.entries(doc.system.schema.fields))
        visit(f, `${path}.${k}`, depth + 1);
    } else if (field.fields && typeof field.fields === 'object') {
      for (const [k, f] of Object.entries(field.fields)) visit(f, `${path}.${k}`, depth + 1);
    } else if (field.element) visit(field.element, `${path}[*]`, depth + 1);
  };
  for (const [k, f] of Object.entries(fields)) visit(f, k, 0);
  return true;
}
