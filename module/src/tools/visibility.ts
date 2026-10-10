/* eslint-disable @typescript-eslint/no-explicit-any */
declare const foundry: any;
declare const CONST: any;

/** What the requesting user may see of one document and, recursively, its embedded documents. */
export interface VisibleNode {
  doc: any;
  /** The user owns this document, so its HTML secrets are shown. */
  owner: boolean;
  /** Embedded collection (or singular embedded document) name to the embedded documents the user may see. */
  children: Record<string, VisibleNode[]>;
  /** Embedded names the user may not see at all; their data is removed. */
  excluded: string[];
  /** Names in `children` that hold one document, not a collection. */
  singular: string[];
}

interface RuleCtx {
  user: any;
  parent: any;
  child: any;
}
type Rule = (c: RuleCtx) => boolean;

const can = (doc: any, user: any, level: string, opts?: object): boolean =>
  typeof doc?.testUserPermission === 'function' &&
  doc.testUserPermission(user, level, opts) === true;

const SECRET_DISPOSITION = (): number => CONST?.TOKEN_DISPOSITIONS?.SECRET ?? -2;

const inherit: Rule = () => true;
const parentObserver: Rule = ({ user, parent }) => can(parent, user, 'OBSERVER');
const childObserver: Rule = ({ user, child }) => can(child, user, 'OBSERVER');
const notHidden: Rule = ({ child }) => child.hidden !== true;

/** Foundry's `Token.isSecret` and the hidden flag, evaluated for `user`. */
const tokenVisible: Rule = ({ user, child }) =>
  child.hidden !== true &&
  !(child.disposition === SECRET_DISPOSITION() && !can(child, user, 'OBSERVER'));

/**
 * Foundry's `Note.isVisible` (client/canvas/placeables/note.mjs): GMs and the author see a note;
 * otherwise LIMITED access to the page, else the entry; with neither, a note is visible unless
 * its author is a GM or unknown.
 */
const noteVisible: Rule = ({ user, child }) => {
  const test = child.page ?? child.entry;
  if (test !== undefined && test !== null) return can(test, user, 'LIMITED');
  const authorId = child._source?.author ?? child.author?.id ?? null;
  if (authorId === user.id) return true;
  return child._source?.author === null || !(child.author?.isGM ?? true);
};

/** An unlinked token's actor data is shown only to someone who may observe the actor. */
const actorObserver: Rule = ({ user, parent }) => can(parent?.actor, user, 'OBSERVER');

/**
 * THE allowlist for non-GM users: parent document type, embedded name, rule. Anything not listed
 * (walls, regions, lights, sounds, templates, tiles, levels, categories and any future embedded
 * type) is excluded. GMs bypass the table.
 */
const EMBEDDED_RULES: Record<string, Record<string, Rule>> = {
  JournalEntry: { pages: childObserver },
  Actor: { items: parentObserver, effects: parentObserver },
  Item: { effects: parentObserver },
  Scene: { tokens: tokenVisible, notes: noteVisible, drawings: notHidden },
  RollTable: { results: inherit },
  Playlist: { sounds: inherit },
  Token: { delta: actorObserver },
  ActorDelta: { items: inherit, effects: inherit },
};

/** Fields only an owner may read, by document type, as dotted paths. */
const OWNER_ONLY_FIELDS: Record<string, string[]> = {
  // Foundry renders `text.content` to non-owners; the markdown source may hold secrets.
  JournalEntryPage: ['text.markdown'],
};

/** Embedded names of a document class: collection name to whether it is a document name key. */
function embeddedNames(doc: any): string[] {
  const meta = doc?.constructor?.metadata?.embedded;
  if (meta && typeof meta === 'object') return Object.values(meta).map(String);
  const hierarchy = doc?.constructor?.hierarchy;
  if (hierarchy && typeof hierarchy === 'object') return Object.keys(hierarchy);
  return [];
}

const isCollection = (v: any): boolean =>
  Array.isArray(v) ||
  (v && typeof v === 'object' && (Array.isArray(v.contents) || v instanceof Map));

const listOf = (collection: any): any[] =>
  Array.from(collection?.contents ?? collection ?? []) as any[];

/** The documents `user` may read below (and including) `doc`; the caller already checked `doc` itself. */
export function visibleTree(doc: any, user: any): VisibleNode {
  const gm = user?.isGM === true;
  const node: VisibleNode = {
    doc,
    owner: gm || can(doc, user, 'OWNER'),
    children: {},
    excluded: [],
    singular: [],
  };
  const rules = EMBEDDED_RULES[doc.documentName] ?? {};
  for (const name of embeddedNames(doc)) {
    const rule = gm ? inherit : rules[name];
    if (!rule) {
      node.excluded.push(name);
      continue;
    }
    const value = doc[name];
    if (isCollection(value)) {
      node.children[name] = listOf(value)
        .filter((e) => rule({ user, parent: doc, child: e }))
        .map((e) => visibleTree(e, user));
    } else if (value && typeof value === 'object') {
      node.singular.push(name);
      node.children[name] = rule({ user, parent: doc, child: value })
        ? [visibleTree(value, user)]
        : [];
    } else node.excluded.push(name);
  }
  return node;
}

/** The node for `target` within a tree, or undefined. */
export function findNode(tree: VisibleNode, target: any): VisibleNode | undefined {
  if (tree.doc === target) return tree;
  for (const kids of Object.values(tree.children)) {
    for (const k of kids) {
      const hit = findNode(k, target);
      if (hit) return hit;
    }
  }
  return undefined;
}

const hashStr = (s: string): string => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

/** A string that changes whenever a visible document changes. */
export function treeStamp(node: VisibleNode): string {
  const t = node.doc._stats?.modifiedTime;
  // Without a modified time, fall back to a hash of the document's own source data.
  const mark =
    t !== undefined && t !== null
      ? String(t)
      : `h${hashStr(JSON.stringify(node.doc._source ?? null))}`;
  let out = `${node.doc.id}:${mark}${node.owner ? 'o' : ''}`;
  for (const [name, kids] of Object.entries(node.children)) {
    out += `|${name}[${kids.map(treeStamp).join(',')}]`;
  }
  return out;
}

/** What is known about one serialised document object while walking its data. */
export interface DocContext {
  owner: boolean;
  /** HTML field path patterns relative to the document (`[*]` array index, `*` mapping key); null when the schema is unknown. */
  html: string[] | null;
  code: string[];
  isMacro: boolean;
}

interface FieldSets {
  html: string[];
  code: string[];
}
const fieldCache = new WeakMap<object, Map<string, FieldSets | null>>();

/** Field paths of the schema for this document's class and type, computed once per class and type. */
function fieldSets(doc: any): FieldSets | null {
  const cls = doc?.constructor;
  const type = String(doc?.type ?? '');
  const store = (cls && typeof cls === 'object') || typeof cls === 'function' ? cls : undefined;
  const hit = store ? fieldCache.get(store)?.get(type) : undefined;
  if (hit !== undefined) return hit;
  const sets = collectFields(doc);
  if (store) {
    const m = fieldCache.get(store) ?? new Map<string, FieldSets | null>();
    m.set(type, sets);
    fieldCache.set(store, m);
  }
  return sets;
}

/** Does `pattern` match `path`? `*` stands for any one dotted segment (a mapping key). */
export function pathMatches(patterns: readonly string[], path: string): boolean {
  const segs = path.split('.');
  return patterns.some((p) => {
    const ps = p.split('.');
    return ps.length === segs.length && ps.every((s, i) => s === '*' || s === segs[i]);
  });
}

/**
 * Remove from `data` every embedded document or collection not in `tree` (recursively), drop
 * owner-only fields for non-owners, and register each remaining document object, root included,
 * in `contexts`.
 */
export function applyTree(
  tree: VisibleNode,
  data: Record<string, any>,
  contexts: Map<object, DocContext>,
): void {
  const sets = fieldSets(tree.doc);
  contexts.set(data, {
    owner: tree.owner,
    html: sets ? sets.html : null,
    code: sets ? sets.code : [],
    isMacro: tree.doc.documentName === 'Macro',
  });
  if (!tree.owner) {
    for (const path of OWNER_ONLY_FIELDS[tree.doc.documentName] ?? []) {
      const parts = path.split('.');
      let obj: any = data;
      for (const p of parts.slice(0, -1)) obj = obj?.[p];
      if (obj && typeof obj === 'object') delete obj[parts[parts.length - 1]!];
    }
  }
  for (const name of tree.excluded) delete data[name];
  for (const [name, kids] of Object.entries(tree.children)) {
    const value = data[name];
    if (tree.singular.includes(name)) {
      if (kids[0] && value && typeof value === 'object') applyTree(kids[0], value, contexts);
      else delete data[name];
      continue;
    }
    if (!Array.isArray(value)) continue;
    const byId = new Map(kids.map((k) => [String(k.doc.id ?? k.doc._id), k]));
    data[name] = value.filter((item) => {
      const kid = byId.get(String(item?._id));
      if (!kid) return false;
      applyTree(kid, item, contexts);
      return true;
    });
  }
}

function collectFields(doc: any): FieldSets | null {
  const fields = doc?.schema?.fields;
  if (!fields || typeof fields !== 'object') return null;
  const html: string[] = [];
  const code: string[] = [];
  const F = foundry?.data?.fields ?? {};
  const isHtml = (f: any) => typeof F.HTMLField === 'function' && f instanceof F.HTMLField;
  const isCode = (f: any) =>
    typeof F.JavaScriptField === 'function' && f instanceof F.JavaScriptField;
  const visit = (field: any, path: string, depth: number): void => {
    if (!field || depth > 12) return;
    if (isHtml(field)) html.push(path);
    else if (isCode(field)) code.push(path);
    else if (path === 'system' && doc.system?.schema?.fields) {
      for (const [k, f] of Object.entries(doc.system.schema.fields))
        visit(f, `${path}.${k}`, depth + 1);
    } else if (field.fields && typeof field.fields === 'object') {
      for (const [k, f] of Object.entries(field.fields)) visit(f, `${path}.${k}`, depth + 1);
    } else if (field.element) {
      // An array element or a mapping value: both spellings, matched by `pathMatches`.
      visit(field.element, `${path}[*]`, depth + 1);
      visit(field.element, `${path}.*`, depth + 1);
    }
  };
  for (const [k, f] of Object.entries(fields)) visit(f, k, 0);
  return { html, code };
}
