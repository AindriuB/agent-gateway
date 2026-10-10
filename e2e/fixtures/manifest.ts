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
  FIXTURE.text.blindMessage,
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

export interface BlindRoll {
  /** Total of the seeded blind roll, once known. */
  total?: number | undefined;
  /** Id of the blind chat message, once known. */
  messageId?: string | undefined;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when the JSON haystack holds an object for message `id` that satisfies `pred`. */
function inMessage(
  haystack: string,
  id: string,
  pred: (o: Record<string, unknown>) => boolean,
): boolean {
  let root: unknown;
  try {
    root = JSON.parse(haystack);
  } catch {
    return false;
  }
  const stack: unknown[] = [root];
  while (stack.length) {
    const v = stack.pop();
    if (Array.isArray(v)) stack.push(...v);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.id === id && pred(o)) return true;
      stack.push(...Object.values(o));
    } else if (typeof v === 'string' && v.trimStart().startsWith('{')) {
      // Raw MCP results carry JSON text inside string fields.
      try {
        stack.push(JSON.parse(v));
      } catch {
        // not JSON
      }
    }
  }
  return false;
}

/** The chat message id from a `ChatMessage.<id>` UUID. */
export const messageIdFromUuid = (uuid: string | undefined): string | undefined =>
  uuid?.split('.').pop() || undefined;

/**
 * The matchers for one run. The blind roll is matched only where it is tied to that message,
 * never by a bare `7d6` (pf2e text has "7d6 fire damage") or a bare number:
 * `"rollFormula":"7d6"` in structured output, `[roll 7d6 = N]` in text, the message's id and its
 * content marker.
 */
export function leakMatchers(blind: BlindRoll = {}): LeakMatcher[] {
  const out: LeakMatcher[] = HIDDEN_STRINGS.map((s) => {
    const needle = s.toLowerCase();
    return { label: s, test: (h: string) => h.toLowerCase().includes(needle) };
  });
  // Every blind-roll matcher is scoped to the seeded blind message: another message with the
  // same formula or the same total is ordinary world chat, not a leak. Without the message id
  // there are no blind-roll matchers; the run requires it (see PlayerCaller).
  const id = blind.messageId;
  if (!id) return out;
  const formula = FIXTURE.chat.blindFormula;
  const f = escapeRe(formula);
  const inRendered = (roll: string) =>
    new RegExp(`\\[roll ${roll}\\] \\([^)]*, ${escapeRe(id)}\\)`, 'i');
  const renderedFormula = inRendered(`${f} = [^\\]]*`);
  out.push({
    label: `rollFormula ${formula} (blind message)`,
    test: (h) => inMessage(h, id, (o) => o.rollFormula === formula),
  });
  out.push({
    label: `[roll ${formula} = ...] (blind message)`,
    test: (h) => renderedFormula.test(h),
  });
  if (blind.total !== undefined) {
    const total = blind.total;
    const renderedTotal = inRendered(`[^\\]]* = ${total}`);
    out.push({
      label: `blind roll total ${total}`,
      test: (h) => renderedTotal.test(h) || inMessage(h, id, (o) => o.rollTotal === total),
    });
  }
  out.push({ label: `blind message id ${id}`, test: (h) => h.includes(`"${id}"`) });
  out.push({ label: `blind message id (rendered)`, test: (h) => h.includes(`, ${id})`) });
  return out;
}
