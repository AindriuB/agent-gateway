/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * defineWriteHandler({targets(args), run(ctx)}) fails closed without the audit stage,
 * awaits snapshots of declared existing targets, then runs the operation. Dynamic targets
 * must be validated and snapshotted within run, inside any serialization turn. Creations
 * declare intendCreate before mutation and record created afterwards; never snapshot a new UUID.
 */
import MarkdownIt from 'markdown-it';
import type { DispatchResult, OpContext, OpHandler } from '../ops/types.js';
import type {} from '../audit/stage.js';

declare const game: any;

export type WriteContext = OpContext &
  Required<Pick<OpContext, 'snapshot' | 'intendCreate' | 'created' | 'callOptions'>>;
export class WriteError extends Error {
  constructor(
    readonly code: 'FORBIDDEN' | 'INVALID_ARGS',
    message: string,
  ) {
    super(message);
  }
}
export const forbid = (message = 'An owned supported world document is required'): never => {
  throw new WriteError('FORBIDDEN', message);
};
export const invalid = (message: string): never => {
  throw new WriteError('INVALID_ARGS', message);
};

export function trustedUser(ctx: OpContext): any {
  const user = game.users?.get(ctx.user.id);
  if (!user || user.id !== ctx.user.id || game.user?.id !== user.id)
    forbid('The current Foundry user is unavailable');
  return user;
}
export function owns(doc: any, user: any): boolean {
  return doc?.testUserPermission?.(user, 'OWNER') === true;
}
// This statically bundled direct dependency disables raw HTML and rejects javascript/data URLs.
const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: true });
/**
 * Native Foundry/PF2e enrichment reads decoded text nodes, not HTML source. Keep its inline
 * roll, @Check/@Damage and @UUID/@Embed control syntax inert, including entities and escaped
 * Markdown. A zero-width separator preserves visible text without executing native enrichers.
 */
const inertNativeText = (text: string): string => text.replace(/[[@]/g, '$&\u200b');
export function markdownHtml(text: string): string {
  const doc = new DOMParser().parseFromString(markdown.render(text), 'text/html');
  const walker = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    node.textContent = inertNativeText(node.textContent ?? '');
  return doc.body.innerHTML;
}
export const escapeHtml = (text: string): string =>
  markdown.utils.escapeHtml(inertNativeText(text));

export function defineWriteHandler(spec: {
  targets(args: unknown): readonly string[] | Promise<readonly string[]>;
  run(ctx: WriteContext): DispatchResult | Promise<DispatchResult>;
}): OpHandler {
  return async (ctx) => {
    if (
      typeof ctx.snapshot !== 'function' ||
      typeof ctx.intendCreate !== 'function' ||
      typeof ctx.created !== 'function' ||
      !ctx.callOptions ||
      typeof ctx.callOptions.agentGateway?.callId !== 'string' ||
      !ctx.callOptions.agentGateway.callId
    )
      return {
        error: { code: 'INTERNAL', message: 'The write audit capabilities are unavailable' },
      };
    try {
      trustedUser(ctx);
      for (const uuid of await spec.targets(ctx.args)) await ctx.snapshot(uuid);
      return await spec.run(ctx as WriteContext);
    } catch (error) {
      if (error instanceof WriteError)
        return { error: { code: error.code, message: error.message } };
      throw error;
    }
  };
}
