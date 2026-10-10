/* eslint-disable @typescript-eslint/no-explicit-any */
import { safeBlock, safeText, decodeBefore } from '../../audit/record.js';
import { serialiseDocument } from '../../serialise/index.js';
import type { StoredTarget } from '../../audit/types.js';

declare const game: any;

export const SHOWN_ENTRIES = 100;
const BEFORE_CHARS = 3000;
const ARGS_CHARS = 4000;

export interface TargetView {
  uuid: string;
  kind: string;
  undoable: boolean;
  note: string;
  before: string;
}

export interface EntryView {
  id: string;
  tool: string;
  category: string;
  status: string;
  time: string;
  user: string;
  agent: string;
  relayed: boolean;
  result: string;
  args: string;
  argsTruncated: boolean;
  targets: TargetView[];
  targetsDropped: number;
  undone: boolean;
  undoneTime: string;
  canUndo: boolean;
}

const kindOf = (t: StoredTarget): string =>
  !t.existed ? 'create' : t.existsAfter ? 'update' : 'delete';

const when = (ms: unknown): string => {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0
    ? new Date(n).toISOString().replace('T', ' ').slice(0, 19)
    : '';
};

/** Pretty JSON of a stored args text, or the text itself when it is not JSON (it may be cut). */
function prettyArgs(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/**
 * Plain strings for the template. Everything stored on a page is untrusted (args come from an
 * agent, relayed records from a player client), so each value is reduced to bounded printable text
 * here, snapshots go through the serialiser (other modules' flags stay out unless opted in), and
 * the template prints every one with `{{ }}`, which escapes HTML. Nothing is printed raw.
 */
export function entryView(page: any): EntryView {
  const s = page?.system ?? {};
  const targets: TargetView[] = (Array.isArray(s.targets) ? s.targets : [])
    .slice(0, 50)
    .map((t: StoredTarget) => {
      const before = decodeBefore(t);
      return {
        uuid: safeText(t.uuid, 300),
        kind: kindOf(t),
        undoable: t.undoable === true,
        note: safeText(t.note, 120),
        before: before
          ? safeBlock(JSON.stringify(serialiseDocument(before), null, 2), BEFORE_CHARS)
          : '',
      };
    });
  const user = game.users?.get?.(s.userId);
  const undone = typeof s.undoneAt === 'number' && s.undoneAt > 0;
  return {
    id: String(page?.id ?? ''),
    tool: safeText(s.tool),
    category: safeText(s.category, 20),
    status: s.status === 'error' ? 'error' : 'ok',
    time: when(s.timestamp),
    user: safeText(user?.name ?? s.userId),
    agent: safeText(s.agentId),
    relayed: s.relayed === true,
    result: safeText(s.result, 500),
    args: safeBlock(prettyArgs(String(s.args ?? '')), ARGS_CHARS),
    argsTruncated: s.argsTruncated === true,
    targets,
    targetsDropped: Number(s.targetsDropped) > 0 ? Math.floor(Number(s.targetsDropped)) : 0,
    undone,
    undoneTime: undone ? when(s.undoneAt) : '',
    canUndo: !undone && targets.some((t) => t.undoable),
  };
}
