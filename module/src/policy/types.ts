/** Who must approve a call before it runs. */
export interface ApprovalRequest {
  approver: 'owner' | 'gm';
}

// Task 16 (approvals) will own this field; until then the policy engine declares it so `ctx.approval`
// is typed without editing the shared ops types.
declare module '../ops/types.js' {
  interface OpContext {
    approval?: ApprovalRequest;
  }
}
