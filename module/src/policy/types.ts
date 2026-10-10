/** Who must approve a call before it runs. */
export interface ApprovalRequest {
  approver: 'owner' | 'gm';
}
