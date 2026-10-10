import { getApprovalManager } from '../approvals/live.js';
import type { OpHandler } from '../ops/types.js';

export const approvalStatusHandler: OpHandler = (ctx) => {
  const { id } = ctx.args as { id: string };
  return getApprovalManager().statusFor(id, ctx);
};
