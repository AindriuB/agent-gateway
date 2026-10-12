import { actorSummaryOutput } from '@agent-gateway/protocol';
import type { OpHandler } from '../ops/types.js';
import { invokeAdapter } from './_adapters.js';
export const actorSummaryHandler: OpHandler = (ctx) =>
  invokeAdapter(
    ctx,
    (ctx.args as { actorUuid: string }).actorUuid,
    actorSummaryOutput,
    (adapter, actor) => adapter.actorSummary(actor),
  );
