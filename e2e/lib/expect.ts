/**
 * What each role must and must not observe, as pure checks over tool results. Each returns a
 * list of problems (empty means pass) so the live suites and the offline tests share them.
 */
import { FIXTURE, FIXTURE_PREFIX } from '../fixtures/spec.js';

export type Role = 'gm' | 'player';

export interface ToolText {
  isError?: boolean;
  text: string;
}

export interface ChatMsg {
  content: string;
  rollFormula?: string | undefined;
  rollTotal?: number | undefined;
}

/** Fixture journal entries a role's `document_search` must list. */
export function expectedEntryNames(role: Role): string[] {
  const { publicEntry, hiddenEntry, limitedEntry } = FIXTURE.names;
  return role === 'gm' ? [publicEntry, hiddenEntry, limitedEntry] : [publicEntry];
}

export function searchProblems(role: Role, names: readonly string[]): string[] {
  const problems: string[] = [];
  const want = expectedEntryNames(role);
  for (const n of want) if (!names.includes(n)) problems.push(`missing ${n}`);
  for (const n of names) {
    if (n.startsWith(FIXTURE_PREFIX) && !want.includes(n)) problems.push(`unexpected ${n}`);
  }
  return problems;
}

/** A hidden or limited document must read as "not found", never as FORBIDDEN. */
export function notFoundProblems(r: ToolText): string[] {
  const problems: string[] = [];
  if (!r.isError) problems.push('expected an error result');
  if (!r.text.startsWith('INVALID_ARGS'))
    problems.push(`error does not start INVALID_ARGS: ${r.text}`);
  if (!r.text.includes('not found')) problems.push(`error does not say "not found": ${r.text}`);
  if (r.text.includes('FORBIDDEN')) problems.push('error mentions FORBIDDEN');
  return problems;
}

/** The player's view of `ag-test-public` as rendered by `document_get`. */
export function playerPublicEntryProblems(content: string): string[] {
  const { text } = FIXTURE;
  const problems: string[] = [];
  if (!content.includes(text.publicPageVisible)) problems.push('public page text missing');
  if (!content.includes(text.markdownVisible)) problems.push('markdown page text missing');
  for (const hidden of [text.gmPage, text.publicPageSecret, text.markdownSecret]) {
    if (content.includes(hidden)) problems.push(`hidden text present: ${hidden}`);
  }
  if (content.includes('text.markdown')) problems.push('text.markdown field present');
  if (!/ownership\.yours\W*:\s*2\b/.test(content)) problems.push('ownership.yours is not 2');
  if (/ownership\.(?!yours\b)\w+/.test(content))
    problems.push('ownership has keys other than yours');
  return problems;
}

const has = (msgs: readonly ChatMsg[], s: string) => msgs.some((m) => m.content.includes(s));

export function chatProblems(role: Role, msgs: readonly ChatMsg[]): string[] {
  const { text, chat } = FIXTURE;
  const problems: string[] = [];
  const need = (s: string, what: string) => {
    if (!has(msgs, s)) problems.push(`missing ${what}`);
  };
  need(text.publicMessage, 'the public message');
  need(text.npcMessage, 'the NPC message');
  need(text.playerWhisper, "player1's own whisper");
  need(text.ownMessage, 'the own-character message');
  const blind = msgs.some((m) => m.rollFormula === chat.blindFormula);
  if (role === 'player') {
    if (has(msgs, text.npcSecret)) problems.push('NPC secret visible');
    if (!has(msgs, text.ownSecret)) problems.push('own-character secret was stripped');
    if (has(msgs, text.gmWhisper)) problems.push('GM whisper visible');
    if (blind) problems.push('blind roll visible');
  } else {
    need(text.gmWhisper, 'the GM whisper');
    if (!has(msgs, text.npcSecret)) problems.push('missing the NPC secret');
    if (!has(msgs, text.ownSecret)) problems.push('missing the own-character secret');
    if (!blind) problems.push('missing the blind roll');
  }
  return problems;
}

export const COMPENDIUM = {
  limitedPack: 'pf2e.abomination-vaults-bestiary',
  observablePacks: ['pf2e.actionspf2e', 'pf2e.journals'],
} as const;

/** Entries on a second page must not repeat the first page. */
export function overlapProblems(first: readonly string[], second: readonly string[]): string[] {
  const seen = new Set(first);
  const dup = second.filter((u) => seen.has(u));
  return dup.length ? [`second page repeats ${dup.length} entries, e.g. ${dup[0]}`] : [];
}

export function worldInfoProblems(
  role: Role,
  info: { worldId?: string; systemId?: string; userName?: string; userRole?: string },
  expected: { world: string; user: string },
): string[] {
  const problems: string[] = [];
  if (info.worldId !== expected.world) problems.push(`world is ${info.worldId}`);
  if (info.systemId !== 'pf2e') problems.push(`system is ${info.systemId}`);
  if (info.userName !== expected.user) problems.push(`user is ${info.userName}`);
  const want = role === 'gm' ? ['GAMEMASTER'] : ['PLAYER', 'TRUSTED'];
  if (!want.includes(info.userRole ?? '')) problems.push(`role is ${info.userRole}`);
  return problems;
}

/** The player's tools must be a subset of the GM's and contain no GM-only tool. */
export function toolListProblems(
  player: readonly string[],
  gm: readonly string[],
  gmOnly: readonly string[],
): string[] {
  const problems: string[] = [];
  for (const n of player) if (!gm.includes(n)) problems.push(`player tool ${n} is not a GM tool`);
  for (const n of player) if (gmOnly.includes(n)) problems.push(`player has GM-only tool ${n}`);
  return problems;
}
