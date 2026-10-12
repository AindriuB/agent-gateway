import { actionPerform, actionPerformOutput } from '@agent-gateway/protocol';
import { defineWriteHandler } from './_write.js';
import { actionOptions, invokeAdapter } from './_adapters.js';
export const actionPerformHandler = defineWriteHandler({
  targets: () => [],
  run(ctx) {
    const args = actionPerform.input.parse(ctx.args);
    const options = actionOptions(args.options);
    return invokeAdapter(
      ctx,
      args.actorUuid,
      actionPerformOutput,
      (adapter, actor, execution) =>
        adapter.performAction(actor, args.actionId, options, execution!),
      true,
    );
  },
});
