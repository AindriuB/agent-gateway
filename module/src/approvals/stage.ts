import type { ToolDefinition } from '@agent-gateway/protocol';
import { liveToolMetadata as toolRegistry } from '../ops/registry-class.js';
import type { Stage } from '../ops/stages.js';
import type { ApprovalManager } from './manager.js';

/** After policy (20) and rate limits (25), before audit (40). */
export const APPROVAL_STAGE_ORDER = 30;

/** Acts only on calls the policy stage marked with `ctx.approval`; every other call passes through. */
export function createApprovalStage(
  getManager: () => ApprovalManager,
  tools?: readonly ToolDefinition[],
): Stage {
  return {
    name: 'approval',
    order: APPROVAL_STAGE_ORDER,
    run(ctx, next) {
      if (!ctx.approval) return next();
      const category =
        (tools
          ? tools.find((d) => d.name === ctx.tool)?.category
          : toolRegistry.categoryOf(ctx.tool)) ?? 'unknown';
      return getManager().request(ctx, category, next);
    },
  };
}
