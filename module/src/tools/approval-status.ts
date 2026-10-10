import type { OpHandler } from '../ops/types.js';

export const approvalStatusHandler: OpHandler = async (ctx) => {
  const { getApprovalManager } = await import('../approvals/live.js');
  const { id } = ctx.args as { id: string };
  return getApprovalManager().statusFor(id, ctx);
};
