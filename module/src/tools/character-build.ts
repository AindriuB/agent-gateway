import { characterBuild, characterBuildOutput } from '@agent-gateway/protocol';
import type { OpHandler } from '../ops/types.js';
import { defineWriteHandler } from './_write.js';
import { invokeAdapter } from './_adapters.js';
import { selectBuildHook } from '../adapters/build.js';
declare const game: { system?: { id?: unknown } };
const hook = () => selectBuildHook(String(game.system?.id));
const write = defineWriteHandler({
  targets: () => [],
  run(ctx) {
    const args = characterBuild.input.parse(ctx.args);
    return invokeAdapter(
      ctx,
      args.actorUuid,
      characterBuildOutput,
      (_adapter, actor, execution) => hook().apply(actor, args.changes ?? [], execution!),
      true,
    );
  },
});
export const characterBuildHandler: OpHandler = (ctx) => {
  const args = characterBuild.input.parse(ctx.args);
  return args.changes !== undefined
    ? write(ctx)
    : invokeAdapter(ctx, args.actorUuid, characterBuildOutput, (_adapter, actor) =>
        hook().describe(actor),
      );
};
characterBuildHandler.prepare = (ctx) => {
  if ((ctx.args as { changes?: unknown }).changes !== undefined) ctx.escalate!('write');
};
