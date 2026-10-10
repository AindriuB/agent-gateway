import { policyStage } from '../policy/stage.js';
import { createApprovalStage } from '../approvals/stage.js';
import { getApprovalManager } from '../approvals/live.js';
import { rateLimitStage } from '../ratelimit/stage.js';
import type { DispatchResult, OpContext } from './types.js';

/**
 * A pipeline stage. Call `next()` to continue; return without calling it to short-circuit.
 * Stages run sorted by `order`, so insertion position in STAGES never matters.
 * Documented orders: agent-control 10, policy 20, rate-limit 25, approval 30, audit 40.
 */
export interface Stage {
  name: string;
  order: number;
  run(ctx: OpContext, next: () => Promise<DispatchResult>): Promise<DispatchResult>;
}

/** Later tasks only insert entries here. */
export const STAGES: Stage[] = [];

STAGES.push(policyStage);
STAGES.push(rateLimitStage); // order 25: after policy (20), before approval

STAGES.push(createApprovalStage(getApprovalManager));
