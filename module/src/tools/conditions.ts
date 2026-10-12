import { conditions, conditionsOutput } from '@agent-gateway/protocol';
import type { OpHandler } from '../ops/types.js';
import { defineWriteHandler } from './_write.js';
import { invokeAdapter } from './_adapters.js';
const write = defineWriteHandler({
  targets: () => [],
  run(ctx) {
    const args = conditions.input.parse(ctx.args);
    return invokeAdapter(
      ctx,
      args.actorUuid,
      conditionsOutput,
      (adapter, actor, execution) => adapter.conditions(actor, args.change, execution),
      true,
    );
  },
});
export const conditionsHandler: OpHandler = (ctx) => {
  const args = conditions.input.parse(ctx.args);
  return args.change !== undefined
    ? write(ctx)
    : invokeAdapter(ctx, args.actorUuid, conditionsOutput, (adapter, actor) =>
        adapter.conditions(actor),
      );
};
conditionsHandler.prepare = (ctx) => {
  if ((ctx.args as { change?: unknown }).change !== undefined) ctx.escalate!('write');
};
