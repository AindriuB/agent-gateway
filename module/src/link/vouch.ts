/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LinkClient } from './client.js';

declare const game: any;
declare const Hooks: any;
declare const ChatMessage: any;
declare const ui: any;

const NS = 'agent-gateway';
const FLAG_KEY = 'vouch';
const MAX_NONCE = 200;
/** How long to wait for the gateway's answer before falling back to "confirmation sent". */
export const ATTEST_RESULT_TIMEOUT_MS = 10_000;

/** Messages already handled here, so a re-fired hook never notifies twice. */
const handled = new WeakSet<object>();

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
 * vouch for it over the admin's own link, then delete the message. A client that was never admin, or
 * a missing or malformed flag, does nothing.
 */
export async function handleVouchMessage(message: any, client: VouchClient): Promise<void> {
  if (!client.isAdmin && !client.wasAdmin) return;
  const nonce = nonceOf(message);
  if (nonce === undefined) return;
  const authorId = message?.author?.id;
  if (typeof authorId !== 'string' || authorId === '') return;
  const author = game.users?.get?.(authorId);
  if (!author) return;
  if (handled.has(message)) return;
  handled.add(message);
  // A GM whose link dropped is still told; only a connected admin link can attest.
  if (!client.isAdmin || !client.attest(nonce, authorId, author.isGM === true)) {
    ui?.notifications?.warn(game.i18n.localize('AGENT_GATEWAY.Pairing.Vouch.notConfirmed'));
    return;
  }
  const player = String(author.name ?? authorId);
  // Registered right after the send; the answer cannot arrive before this returns.
  const waiter = client.expectAttestResult?.(nonce) ?? null;
  try {
    await message.delete();
  } catch {
    // Another admin may have deleted it first; the vouch is already sent.
  }
  const outcome = waiter ? await withTimeout(waiter) : null;
  const key = outcome === 'paired' ? 'paired' : outcome === 'refused' ? 'refused' : 'confirmed';
  const notify = outcome === 'refused' ? ui?.notifications?.warn : ui?.notifications?.info;
  notify?.call(
    ui.notifications,
    game.i18n.format(`AGENT_GATEWAY.Pairing.Vouch.${key}`, { player }),
  );
}

type VouchClient = Pick<LinkClient, 'isAdmin' | 'wasAdmin' | 'attest'> &
  Partial<Pick<LinkClient, 'expectAttestResult'>>;

/** The gateway's answer, or null after the timeout (the wait is dropped) or a disconnect. */
function withTimeout(w: {
  result: Promise<'paired' | 'refused' | null>;
  cancel: () => void;
}): Promise<'paired' | 'refused' | null> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      w.cancel();
      resolve(null);
    }, ATTEST_RESULT_TIMEOUT_MS);
  });
  return Promise.race([w.result, timeout]).finally(() => clearTimeout(timer));
}

/** Register the `createChatMessage` hook on the admin's side. Idempotent callers: call once. */
export function installVouchHook(client: VouchClient): void {
  Hooks.on('createChatMessage', (message: unknown) => {
    void handleVouchMessage(message, client);
  });
}
