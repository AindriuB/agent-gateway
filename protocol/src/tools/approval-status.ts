import { z } from 'zod';
import { defineTool } from './define.js';

/**
 * How long a call that needs approval waits for an answer before it returns pending_approval.
 * It must stay well under the gateway's link-call timeout (30 s), or the agent is told the call
 * timed out instead of being given the approval id.
 */
export const APPROVAL_WAIT_MS = 25_000;

export const approvalStatus = defineTool({
  name: 'approval_status',
  minRole: 'player',
  category: 'read',
  handledBy: 'module',
  description:
    'Check an approval that a previous call returned as pending_approval. Only the agent that made the request can look it up.',
  input: z.strictObject({
    id: z.string().min(1).max(100).describe('The approval id from the pending_approval result'),
  }),
  output: z.strictObject({
    id: z.string().describe('The approval id'),
    status: z
      .enum(['pending', 'approved', 'denied', 'expired'])
      .describe('pending, approved, denied or expired'),
    reason: z.string().optional().describe('The approver reason, when the request was denied'),
    result: z
      .string()
      .optional()
      .describe('Text result of the approved call; absent while it is still running'),
    resultFailed: z.boolean().optional().describe('True when the approved call ended in an error'),
  }),
});
