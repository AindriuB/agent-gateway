/* eslint-disable @typescript-eslint/no-explicit-any */
import { chatRead } from '@agent-gateway/protocol';
import type { OpHandler } from '../ops/types.js';
import { htmlToDocument, page } from '../serialise/index.js';
import { inlineText } from './compendium-search.js';

declare const game: any;

const NS = 'agent-gateway';
/** Per-message content cap, in characters of markdown. */
const CONTENT_CAP = 2000;
const FORMULA_CAP = 200;

const authorIdOf = (msg: any): string | undefined => {
  const a = msg.author ?? msg.user;
  return (typeof a === 'string' ? a : a?.id) ?? msg._source?.author ?? msg._source?.user;
};

/** Chat visibility for a given user (not game.user): public, own, whispered to them, or GM-visible blind. */
function visibleTo(msg: any, userId: string, isGM: boolean): boolean {
  const isAuthor = authorIdOf(msg) === userId;
  const whisper: unknown[] = Array.isArray(msg.whisper) ? msg.whisper : [];
  if (whisper.length > 0) return isAuthor || whisper.includes(userId);
  if (msg.blind) return isAuthor || isGM;
  return true;
}

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
  const all: any[] = [...(game.messages.contents as any[])].sort(
    (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0) || String(a.id).localeCompare(String(b.id)),
  );
  let end = all.length;
  if (before !== undefined) {
    const at = all.findIndex((m) => m.id === before);
    if (at < 0 || !visibleTo(all[at], ctx.user.id, ctx.user.isGM)) {
      return { error: { code: 'INVALID_ARGS', message: 'Message not found.' } };
    }
    end = at;
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
  if (more && picked.length) structured.nextBefore = String(picked[0].id);
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
