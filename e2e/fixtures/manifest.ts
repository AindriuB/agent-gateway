/**
 * Strings that a non-GM user must never receive from any tool. The leak check scans the
 * serialised JSON of every player result for each of them. Keep these in step with spec.ts.
 */
import { FIXTURE } from './spec.js';

/** Plain strings, matched case-insensitively. */
export const HIDDEN_STRINGS: readonly string[] = [
  // Hidden or limited documents, and the folder that holds the hidden one.
  FIXTURE.names.hiddenEntry,
  FIXTURE.names.hiddenFolder,
  FIXTURE.names.limitedEntry,
  // Secrets and GM-only page text.
  FIXTURE.text.hiddenBody,
  FIXTURE.text.limitedBody,
  FIXTURE.text.publicPageSecret,
  FIXTURE.text.markdownSecret,
  FIXTURE.text.gmPage,
  FIXTURE.text.npcSecret,
  // GM-only chat.
  FIXTURE.text.gmWhisper,
  FIXTURE.chat.blindFormula,
  // Scene placeables a player has no way to see through these tools.
  ...Object.values(FIXTURE.placeables),
];

/** Strings a player is allowed to see (used to prove the checker is not simply matching everything). */
export const VISIBLE_STRINGS: readonly string[] = [
  FIXTURE.names.publicEntry,
  FIXTURE.text.publicMessage,
  FIXTURE.text.playerWhisper,
  FIXTURE.text.ownSecret,
];

export type LeakMatcher = { label: string; test: (haystack: string) => boolean };

/**
 * The matchers for one run. A bare number such as the blind roll total would match timestamps
 * and ids, so the total is matched only where it is labelled as a total.
 */
export function leakMatchers(blindRollTotal?: number): LeakMatcher[] {
  const out: LeakMatcher[] = HIDDEN_STRINGS.map((s) => {
    const needle = s.toLowerCase();
    return { label: s, test: (h: string) => h.toLowerCase().includes(needle) };
  });
  if (blindRollTotal !== undefined) {
    const n = String(blindRollTotal);
    const re = new RegExp(`("rollTotal"\\s*:\\s*${n}\\b)|(=\\s*${n}\\b)`);
    out.push({ label: `blind roll total ${n}`, test: (h) => re.test(h) });
  }
  return out;
}
