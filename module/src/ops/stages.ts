import { policyStage } from '../policy/stage.js';
import { auditStage, installAudit } from '../audit/index.js';
import type { DispatchResult, OpContext } from './types.js';

/**
 * A pipeline stage. Call `next()` to continue; return without calling it to short-circuit.
 * Stages run sorted by `order`, so insertion position in STAGES never matters.
 * Documented orders: agent-control 10, policy 20, rate-limit 30, approval 40, audit 50.
 */
export interface Stage {
  name: string;
  order: number;
  run(ctx: OpContext, next: () => Promise<DispatchResult>): Promise<DispatchResult>;
}

/** Later tasks only insert entries here. */
export const STAGES: Stage[] = [];

STAGES.push(policyStage);
// Audit (task 19): order 40, after approval. Records calls that are not reads.
STAGES.push(auditStage);
installAudit();
