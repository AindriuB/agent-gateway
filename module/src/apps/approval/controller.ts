import { cleanText } from '../../approvals/manager.js';
import { reviewable } from './model.js';
import type { ApprovalManager } from '../../approvals/manager.js';
import type { ResolveOptions } from '../../approvals/types.js';

export type PendingApproval = ReturnType<ApprovalManager['listPending']>[number];
export interface ApprovalGroup {
  id: string;
  requests: PendingApproval[];
}
export interface ApprovalUiDeps {
  manager(): Pick<ApprovalManager, 'listPending' | 'resolveApproval' | 'ownRecords'>;
  isGM(): boolean;
  now(): number;
  on(hook: string, callback: () => void): void;
  present(groups: ApprovalGroup[]): void;
}

/** Hooks are signals only: current manager state is the authority for display and action. */
export class ApprovalUiController {
  private installed = false;
  private groups = new Map<string, { agent: string; session: string; at: number }>();
  private membership = new Map<string, string>();
  private sequence = 0;

  constructor(private deps: ApprovalUiDeps) {}

  install(): void {
    if (!this.installed) {
      this.installed = true;
      this.deps.on('agentGateway.approvalRequested', () => this.refresh());
      this.deps.on('agentGateway.approvalResolved', () => this.refresh());
      this.deps.on('updateUser', () => this.refresh());
    }
    this.refresh();
  }

  pending(): PendingApproval[] {
    return this.deps
      .manager()
      .listPending()
      .filter((request) => request.local || this.deps.isGM());
  }

  refresh(): void {
    const pending = this.pending();
    const ids = new Set(pending.map((r) => r.id));
    for (const id of this.membership.keys()) if (!ids.has(id)) this.membership.delete(id);
    const liveGroups = new Set(this.membership.values());
    for (const id of this.groups.keys()) if (!liveGroups.has(id)) this.groups.delete(id);
    const now = this.deps.now();
    for (const request of pending) {
      if (this.membership.has(request.id)) continue;
      const match = [...this.groups].find(
        ([, g]) =>
          g.agent === request.agentId && g.session === request.sessionId && now - g.at <= 2000,
      );
      const id = match?.[0] ?? `approval-group-${++this.sequence}`;
      if (!match)
        this.groups.set(id, { agent: request.agentId, session: request.sessionId, at: now });
      this.membership.set(request.id, id);
    }
    this.deps.present(
      [...this.groups.keys()].map((id) => ({
        id,
        requests: pending.filter((r) => this.membership.get(r.id) === id),
      })),
    );
  }

  resolve(id: string, options: ResolveOptions): boolean {
    if (options.decision === 'deny') {
      options = { ...options, reason: cleanText(options.reason, 500) };
      if (!options.reason) return false;
    }
    const request = this.pending().find((r) => r.id === id);
    if (options.decision === 'approve' && request && !reviewable(request.args)) return false;
    // A role/eligibility change since rendering must not leave a usable stale action.
    if (!this.pending().some((request) => request.id === id)) {
      this.refresh();
      return false;
    }
    const accepted = this.deps.manager().resolveApproval(id, options);
    this.refresh();
    return accepted;
  }

  approveGroup(id: string): void {
    const requests = this.pending().filter((r) => this.membership.get(r.id) === id);
    for (const request of requests)
      this.resolve(request.id, { decision: 'approve', scope: 'once' });
  }
}
