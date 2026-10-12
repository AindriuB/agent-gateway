import { inventoryOutput } from '@agent-gateway/protocol';
import type { OpHandler } from '../ops/types.js';
import { invokeAdapter } from './_adapters.js';
export const inventoryHandler: OpHandler = (ctx) =>
  invokeAdapter(
    ctx,
    (ctx.args as { actorUuid: string }).actorUuid,
    inventoryOutput,
    (adapter, actor) => adapter.inventorySemantics(actor),
  );
