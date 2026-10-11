/* eslint-disable @typescript-eslint/no-explicit-any */
import { targetSet } from '@agent-gateway/protocol';
import { fromUuidCompat } from '../compat/index.js';
import { defineWriteHandler, invalid, trustedUser, forbid } from './_write.js';
import { checkSceneToken } from './token-move.js';
declare const canvas: any;
export const targetSetHandler = defineWriteHandler({
  targets: () => [],
  async run(ctx) {
    const args = targetSet.input.parse(ctx.args);
    if (args.mode === 'clear' && args.tokenUuids.length)
      invalid('Clear requires an empty token list');
    const tokens = await Promise.all(args.tokenUuids.map((uuid) => fromUuidCompat(uuid)));
    for (const token of tokens) checkSceneToken(ctx, token, false);
    const user = trustedUser(ctx);
    if (canvas?.ready !== true || typeof canvas.tokens?.setTargets !== 'function')
      forbid('Native targeting is unavailable');
    const selected = new Map<string, any>();
    if (args.mode === 'add')
      for (const token of user.targets ?? []) {
        checkSceneToken(ctx, token.document, false);
        selected.set(token.id, token.document);
        if (selected.size > 10) invalid('At most ten resulting targets are supported');
      }
    for (const token of tokens) selected.set(token.id, token);
    if (selected.size > 10) invalid('At most ten resulting targets are supported');
    // No snapshots: targets are transient user state, not an undoable document mutation.
    trustedUser(ctx);
    canvas.tokens.setTargets(args.mode === 'clear' ? [] : tokens.map((token) => token.id), {
      mode: args.mode === 'add' ? 'acquire' : 'replace',
    });
    return {
      text: 'Your targets updated',
      structured: {
        tokenUuids: args.mode === 'clear' ? [] : [...selected.values()].map((token) => token.uuid),
      },
    };
  },
});
