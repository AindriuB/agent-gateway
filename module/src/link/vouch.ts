/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LinkClient } from './client.js';

declare const game: any;
declare const Hooks: any;
declare const ChatMessage: any;

const NS = 'agent-gateway';
const FLAG_KEY = 'vouch';
const MAX_NONCE = 200;

/** Ids of the GM users who are logged in now; the only recipients of a vouch whisper. */
export function activeGmIds(): string[] {
  const ids: string[] = [];
  for (const u of game.users ?? [])
    if (u?.active === true && u.isGM === true) ids.push(String(u.id));
  return ids;
}

/**
 * Player side: post one whispered chat message flagged with the challenge nonce. Foundry records
 * the author on the server, which is what the admin GM's module reads. The content carries no
 * nonce, token or code. Returns false (and posts nothing) when no GM is online: a whisper with no
 * recipients would be public.
 */
export async function postVouch(nonce: string): Promise<boolean> {
  const whisper = activeGmIds();
  if (whisper.length === 0) return false;
  await ChatMessage.create({
    content: game.i18n.localize('AGENT_GATEWAY.Pairing.Vouch.content'),
    whisper,
    flags: { [NS]: { [FLAG_KEY]: { nonce } } },
  });
  return true;
}

/** The nonce of a well-formed vouch flag, else undefined. */
function nonceOf(message: any): string | undefined {
  const vouch = message?.flags?.[NS]?.[FLAG_KEY];
  if (!vouch || typeof vouch !== 'object' || Array.isArray(vouch)) return undefined;
  const nonce = (vouch as { nonce?: unknown }).nonce;
  return typeof nonce === 'string' && nonce.length > 0 && nonce.length <= MAX_NONCE
    ? nonce
    : undefined;
}

/**
 * Admin side: for a flagged message, read the author Foundry set (never a flag or the content),
 * vouch for it over the admin's own link, then delete the message. A client that is not admin, or
 * a missing or malformed flag, does nothing.
 */
export async function handleVouchMessage(
  message: any,
  client: Pick<LinkClient, 'isAdmin' | 'attest'>,
): Promise<void> {
  if (!client.isAdmin) return;
  const nonce = nonceOf(message);
  if (nonce === undefined) return;
  const authorId = message?.author?.id;
  if (typeof authorId !== 'string' || authorId === '') return;
  const author = game.users?.get?.(authorId);
  if (!author) return;
  if (!client.attest(nonce, authorId, author.isGM === true)) return;
  try {
    await message.delete();
  } catch {
    // Another admin may have deleted it first; the vouch is already sent.
  }
}

/** Register the `createChatMessage` hook on the admin's side. Idempotent callers: call once. */
export function installVouchHook(client: Pick<LinkClient, 'isAdmin' | 'attest'>): void {
  Hooks.on('createChatMessage', (message: unknown) => {
    void handleVouchMessage(message, client);
  });
}
