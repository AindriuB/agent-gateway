import { actionsListOutput } from '@agent-gateway/protocol';
import type { OpHandler } from '../ops/types.js';
import { invokeAdapter } from './_adapters.js';
export const actionsListHandler: OpHandler = (ctx) =>
  invokeAdapter(
    ctx,
    (ctx.args as { actorUuid: string }).actorUuid,
    actionsListOutput,
    (adapter, actor) => adapter.listActions(actor),
  );
