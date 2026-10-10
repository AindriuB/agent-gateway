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
  id?: string | undefined;
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
  // Anchored to a line start: the top-level field, not `pages[n].ownership.*`.
  if (!/^\**ownership\.yours\**\s*:\s*2\b/m.test(content))
    problems.push('ownership.yours is not 2');
  if (/^\**ownership\.(?!yours\b)/m.test(content)) {
    problems.push('ownership has keys other than yours');
  }
  return problems;
}

const has = (msgs: readonly ChatMsg[], s: string) => msgs.some((m) => m.content.includes(s));

/** `blindId` is the seeded blind message's id: only that message counts as the blind roll. */
export function chatProblems(role: Role, msgs: readonly ChatMsg[], blindId: string): string[] {
  const { text, chat } = FIXTURE;
  const problems: string[] = [];
  const need = (s: string, what: string) => {
    if (!has(msgs, s)) problems.push(`missing ${what}`);
  };
  need(text.publicMessage, 'the public message');
  need(text.npcMessage, 'the NPC message');
  need(text.playerWhisper, "player1's own whisper");
  need(text.ownMessage, 'the own-character message');
  const blindMsg = msgs.find((m) => m.id === blindId);
  if (role === 'player') {
    if (has(msgs, text.npcSecret)) problems.push('NPC secret visible');
    if (!has(msgs, text.ownSecret)) problems.push('own-character secret was stripped');
    if (has(msgs, text.gmWhisper)) problems.push('GM whisper visible');
    if (blindMsg || has(msgs, text.blindMessage)) problems.push('blind roll visible');
  } else {
    need(text.gmWhisper, 'the GM whisper');
    if (!has(msgs, text.npcSecret)) problems.push('missing the NPC secret');
    if (!has(msgs, text.ownSecret)) problems.push('missing the own-character secret');
    if (!blindMsg) problems.push('missing the blind roll');
    else if (blindMsg.rollFormula !== chat.blindFormula)
      problems.push('blind roll has the wrong formula');
  }
  return problems;
}

export const COMPENDIUM = {
  limitedPack: 'pf2e.abomination-vaults-bestiary',
  observablePacks: ['pf2e.actionspf2e', 'pf2e.journals'],
} as const;

const MIN_PROSE = 40;
const LEADING = 5;

/**
 * Prose lines of a markdown page: long enough to be distinctive, not table rows and not fences.
 * The pager repeats table headers and reopens fences by design, so those never count.
 */
export function proseLines(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= MIN_PROSE && !l.startsWith('|') && !/^(```|~~~)/.test(l));
}

/** The second page's leading prose must not already appear on the first page. */
export function overlapProblems(firstPage: string, secondPage: string): string[] {
  const seen = new Set(proseLines(firstPage));
  const lead = proseLines(secondPage).slice(0, LEADING);
  if (lead.length === 0) return ['second page has no prose to compare'];
  const dup = lead.filter((l) => seen.has(l));
  return dup.length ? [`second page starts by repeating the first: ${dup[0]}`] : [];
}

export function worldInfoProblems(
  role: Role,
  info: { worldId?: string; systemId?: string; userName?: string; userRole?: string },
  expected: { world: string; user: string },
): string[] {
  const problems: string[] = [];
  if (info.worldId !== expected.world) problems.push(`world is ${info.worldId}`);
  if (info.systemId !== 'pf2e') problems.push(`system is ${info.systemId}`);
  if (info.userName?.toLowerCase() !== expected.user.toLowerCase())
    problems.push(`user is ${info.userName}`);
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
