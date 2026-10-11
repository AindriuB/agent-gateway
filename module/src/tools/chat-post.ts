/* eslint-disable @typescript-eslint/no-explicit-any */
import { chatPost } from '@agent-gateway/protocol';
import { isAuditDocument } from '../audit/guard.js';
import {
  defineWriteHandler,
  forbid,
  invalid,
  markdownHtml,
  owns,
  trustedUser,
  type WriteContext,
} from './_write.js';

declare const game: any;
declare const fromUuid: (uuid: string) => Promise<any>;
declare const ChatMessage: any;

/** Native v14 HTMLElement hook and v13 jQuery/HTMLElement hook; idempotent when both fire. */
export function markAgentChat(message: any, html: any): void {
  if (message?.flags?.['agent-gateway']?.ai !== true) return;
  const root = html?.nodeType === 1 ? html : html?.[0];
  if (!root?.querySelector || root.querySelector('.agent-gateway-ai-marker')) return;
  const badge = root.ownerDocument.createElement('span');
  badge.className = 'agent-gateway-ai-marker';
  badge.textContent = 'AI';
  badge.setAttribute(
    'aria-label',
    game.i18n?.localize?.('AGENT_GATEWAY.Tools.aiMarker') ?? 'AI-authored',
  );
  (root.querySelector('.message-header') ?? root).append(badge);
}
/** Refuse native update forms that would erase an existing immutable agent marker. */
export function protectAgentMarker(
  message: any,
  changes: any,
  options: any = {},
): false | undefined {
  if (message?.flags?.['agent-gateway']?.ai !== true) return;
  // Foundry expands dotted paths, including ancestor deletion paths, before applying updates.
  const pending: Array<[string[], any]> = [];
  for (const key in changes) {
    if (!Object.hasOwn(changes, key)) continue;
    if (pending.length >= 256) return false;
    pending.push([key.split('.'), changes[key]]);
  }
  let work = 0;
  while (pending.length) {
    if (++work > 256) return false;
    const [path, value] = pending.pop()!;
    if (path.length > 16) return false;
    if (
      path[0] === '-=flags' ||
      (path[0] === 'flags' && path[1] === '-=agent-gateway') ||
      (path[0] === 'flags' && path[1] === 'agent-gateway' && path[2] === '-=ai')
    )
      return false;
    if (
      path[0] === 'flags' &&
      path[1] === 'agent-gateway' &&
      path[2] === 'ai' &&
      (path.length !== 3 || value !== true)
    )
      return false;
    if (
      path[0] === 'flags' &&
      path.length <= 2 &&
      (!value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    )
      return false;
    if (value && typeof value === 'object')
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        if (pending.length + work >= 256) return false;
        pending.push([[...path, ...key.split('.')], value[key]]);
      }
  }
  if (
    options.recursive === false &&
    Object.hasOwn(changes, 'flags') &&
    changes.flags?.['agent-gateway']?.ai !== true
  )
    return false;
  if (
    options.recursive === false &&
    Object.hasOwn(changes, 'flags.agent-gateway') &&
    changes['flags.agent-gateway']?.ai !== true
  )
    return false;
}
const hooks = (globalThis as any).Hooks;
hooks?.on('renderChatMessageHTML', markAgentChat);
hooks?.on('renderChatMessage', markAgentChat);
hooks?.on('preUpdateChatMessage', protectAgentMarker);

export async function createAgentMessage(
  ctx: WriteContext,
  data: Record<string, unknown>,
  validate?: () => Promise<() => void>,
): Promise<string> {
  await ctx.intendCreate();
  if (validate) {
    const finalCheck = await validate();
    finalCheck();
  }
  trustedUser(ctx);
  // Flags and write correlation cannot be overridden by args or roll data.
  const message = await ChatMessage.create(
    { ...data, flags: { 'agent-gateway': { ai: true } } },
    ctx.callOptions,
  );
  if (typeof message?.uuid !== 'string' || !message.uuid)
    throw new Error('Chat creation returned no UUID');
  await ctx.created(message.uuid);
  return message.uuid;
}

export const chatPostHandler = defineWriteHandler({
  targets: () => [],
  async run(ctx) {
    const args = chatPost.input.parse(ctx.args);
    const content = markdownHtml(args.content);
    let speaker: Record<string, string> | undefined;
    let whisper: string[] | undefined;
    const prepare = async () => {
      const actor = args.speakerActorUuid ? await fromUuid(args.speakerActorUuid) : undefined;
      // Return a synchronous check, called after the final asynchronous preparation resolves.
      return () => {
        const user = trustedUser(ctx);
        if (args.speakerActorUuid) {
          if (
            actor?.documentName !== 'Actor' ||
            actor.pack ||
            isAuditDocument(actor) ||
            !owns(actor, user)
          )
            forbid('An owned world actor is required');
          speaker = { actor: actor.id, alias: actor.name };
        }
        if (args.whisperTo)
          whisper = [
            ...new Set(
              args.whisperTo.map((name) => {
                const matches = (game.users.contents as any[]).filter((u) => u.name === name);
                if (matches.length !== 1)
                  invalid('Whisper recipient names must identify exactly one user');
                return String(matches[0].id);
              }),
            ),
          ];
        if (speaker) data.speaker = speaker;
        if (whisper) data.whisper = whisper;
      };
    };
    const data: Record<string, unknown> = { content };
    const initialCheck = await prepare();
    initialCheck();
    const messageUuid = await createAgentMessage(ctx, data, prepare);
    return { text: `AI chat message posted: ${messageUuid}`, structured: { messageUuid } };
  },
});
