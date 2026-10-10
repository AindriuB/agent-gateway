/* eslint-disable @typescript-eslint/no-explicit-any */
import { chatRead } from '@agent-gateway/protocol';
import type { OpHandler } from '../ops/types.js';
import { htmlToDocument, inlineText, page } from '../serialise/index.js';

declare const game: any;

const NS = 'agent-gateway';
/** Per-message content cap, in characters of markdown. */
const CONTENT_CAP = 2000;
const FORMULA_CAP = 200;

const authorIdOf = (msg: any): string | undefined => {
  const a = msg.author ?? msg.user;
  return (typeof a === 'string' ? a : a?.id) ?? msg._source?.author ?? msg._source?.user;
};

/**
 * Whether `userId` may see the message at all, evaluated for that user rather than `game.user`.
 * Verified against Foundry v14 client/documents/chat-message.mjs L59-108: `isContentVisible` hides a
 * blind message's content from its author unless GM (L69-72) and from non-recipients of a whisper
 * (L74-75); `visible` limits a non-roll whisper to its author and recipients (L99-104).
 * Deliberately stricter on blind rolls: a non-GM never gets one (not as author, not as recipient), so no
 * content, formula or total can reach an agent. A GM gets a blind roll only if they are its author or
 * a whisper recipient, or it has no recipients. A GM who is not in `whisper` does not.
 */
function visibleTo(msg: any, userId: string, isGM: boolean): boolean {
  const whisper: unknown[] = Array.isArray(msg.whisper) ? msg.whisper : [];
  const isAuthor = authorIdOf(msg) === userId;
  if (msg.blind) return isGM && (isAuthor || whisper.length === 0 || whisper.includes(userId));
  if (whisper.length > 0) return isAuthor || whisper.includes(userId);
  return true;
}

/** `before` is `<timestamp>.<message id>`, the form `nextBefore` is returned in. */
const BEFORE_RE = /^(\d{1,16})\.(.+)$/;

function speakerOf(msg: any): string {
  const alias = msg.speaker?.alias;
  if (typeof alias === 'string' && alias.trim()) return alias;
  const actor = msg.speaker?.actor ? game.actors?.get(msg.speaker.actor) : undefined;
  if (actor?.name) return String(actor.name);
  const author = game.users?.get(authorIdOf(msg) ?? '');
  return String(author?.name ?? 'Unknown');
}

export const chatReadHandler: OpHandler = (ctx) => {
  const { limit, before } = chatRead.input.parse(ctx.args);
  // Foundry's collection is already in creation order, so timestamps do not decrease along it.
  const all: any[] = game.messages.contents;
  let end = all.length;
  if (before !== undefined) {
    const m = BEFORE_RE.exec(before);
    if (!m) return { error: { code: 'INVALID_ARGS', message: 'Invalid before cursor.' } };
    const ts = Number(m[1]);
    const at = all.findIndex((x) => x.id === m[2]);
    // A deleted anchor still pages by time: everything strictly newer than it is excluded.
    end = at >= 0 ? at : all.findIndex((x) => (Number(x.timestamp) || 0) > ts);
    if (end < 0) end = all.length;
  }

  const picked: any[] = [];
  let more = false;
  for (let i = end - 1; i >= 0; i--) {
    if (!visibleTo(all[i], ctx.user.id, ctx.user.isGM)) continue;
    if (picked.length >= limit) {
      more = true;
      break;
    }
    picked.push(all[i]);
  }
  picked.reverse();

  const messages = picked.map((msg) => {
    const first = page(htmlToDocument(String(msg.content ?? '')), null, CONTENT_CAP);
    const roll = Array.isArray(msg.rolls) ? msg.rolls[0] : undefined;
    const out: Record<string, unknown> = {
      id: String(msg.id),
      speaker: speakerOf(msg),
      timestamp: Number(msg.timestamp) || 0,
      content: first.chunk,
      truncated: first.nextCursor !== null,
      aiAuthored: msg.flags?.[NS]?.ai === true,
    };
    if (roll && typeof roll.formula === 'string') {
      out.rollFormula = roll.formula.slice(0, FORMULA_CAP);
      if (Number.isFinite(roll.total)) out.rollTotal = roll.total;
    }
    return out;
  });

  const structured: Record<string, unknown> = { messages };
  if (more && picked.length)
    structured.nextBefore = `${Number(picked[0].timestamp) || 0}.${picked[0].id}`;
  const text = messages.length
    ? messages
        .map((m) => {
          const roll = m.rollFormula
            ? ` [roll ${inlineText(m.rollFormula)} = ${m.rollTotal ?? '?'}]`
            : '';
          const ai = m.aiAuthored ? ' [AI]' : '';
          return `**${inlineText(m.speaker)}**${ai}${roll} (${new Date(m.timestamp as number).toISOString()}, ${inlineText(m.id)})\n\n${m.content as string}`;
        })
        .join('\n\n---\n\n')
    : 'No chat messages.';
  return { text, structured };
};
