/* eslint-disable @typescript-eslint/no-explicit-any */
import { getApprovalManager } from '../../approvals/live.js';
import {
  getApplicationV2,
  getHandlebarsApplicationMixin,
  fromUuidCompat,
} from '../../compat/index.js';
import { toolRegistry } from '../../ops/registry.js';
import { ApprovalUiController, type ApprovalGroup, type PendingApproval } from './controller.js';
import { computeDiff, pretty, updatedDocument, reviewable } from './model.js';

declare const game: any;
declare const Hooks: any;
declare const ui: any;
const NS = 'agent-gateway';

/** Labels are Foundry identities. The protocol's canonical agent id is its available label. */
export async function requestView(request: PendingApproval): Promise<object> {
  const safe = reviewable(request.args);
  const info = toolRegistry.info(request.tool);
  const record = request.local
    ? getApprovalManager()
        .ownRecords()
        .find((r) => r.id === request.id)
    : undefined;
  const ownerId = record?.agentOwnerId ?? request.requesterId;
  const args = request.args as Record<string, unknown> | null;
  let diff: ReturnType<typeof computeDiff> = [];
  let unavailable = false;
  // Pack tools always retain their generic renderer, even when their name resembles a core tool.
  if (
    safe &&
    info?.origin === 'core' &&
    request.tool === 'document_update' &&
    typeof args?.uuid === 'string'
  ) {
    try {
      const document = await fromUuidCompat(args.uuid);
      const changes =
        typeof args.update === 'string' ? JSON.parse(args.update) : (args.changes ?? args.data);
      if (
        document?.testUserPermission?.(game.user, 'OWNER') &&
        changes &&
        typeof changes === 'object' &&
        !Array.isArray(changes) &&
        reviewable(changes)
      ) {
        const before = document.toObject();
        diff = computeDiff(before, updatedDocument(before, changes as Record<string, unknown>));
      } else unavailable = true;
    } catch {
      unavailable = true;
    }
  }
  const origin = info?.origin;
  return {
    id: request.id,
    agent: request.agentId,
    owner: game.users?.get(ownerId)?.name ?? ownerId,
    requester: game.users?.get(request.requesterId)?.name ?? request.requesterId,
    tool: request.tool,
    category: request.category,
    args: safe ? pretty(request.args) : game.i18n.localize('AGENT_GATEWAY.ApprovalDialog.tooLarge'),
    reviewable: safe,
    diff,
    unavailable,
    code:
      request.category === 'code' && safe
        ? typeof args?.source === 'string'
          ? args.source
          : typeof args?.code === 'string'
            ? args.code
            : pretty(request.args)
        : undefined,
    isCode: request.category === 'code' && safe,
    pack: origin && origin !== 'core' ? { id: origin.packId, version: origin.version } : undefined,
    // Task 16 intentionally refuses session grants for code.
    sessionAllowed: request.category !== 'code' && !request.replay,
  };
}

/** Built on first presentation, after Foundry has initialised its ApplicationV2 API. */
export function createApprovalApp(controller: ApprovalUiController): any {
  const Base = getHandlebarsApplicationMixin()(getApplicationV2());
  return class ApprovalApp extends Base {
    static DEFAULT_OPTIONS = {
      id: 'agent-gateway-approval',
      window: {
        title: 'AGENT_GATEWAY.ApprovalDialog.title',
        icon: 'fa-solid fa-check-to-slot',
        resizable: true,
      },
      position: { width: 800, height: 700 },
      actions: {
        approve: this.approve,
        session: this.session,
        deny: this.deny,
        approveAll: this.approveAll,
        previous: this.previous,
        next: this.next,
      },
    };
    static PARTS = {
      requests: { template: `modules/${NS}/templates/approval/approval.hbs`, scrollable: [''] },
    };
    groups: ApprovalGroup[] = [];
    page = 0;
    async _prepareContext(): Promise<object> {
      // Manager rechecks role and pending state even on a rerender of an already open window.
      const eligible = new Set(controller.pending().map((r) => r.id));
      const requests = this.groups.flatMap((g) => g.requests).filter((r) => eligible.has(r.id));
      this.page = Math.max(0, Math.min(this.page, Math.ceil(requests.length / 5) - 1));
      const visible = new Set(requests.slice(this.page * 5, this.page * 5 + 5).map((r) => r.id));
      const groups = await Promise.all(
        this.groups.map(async (group) => {
          const shown = group.requests.filter((r) => visible.has(r.id));
          return { id: group.id, requests: await Promise.all(shown.map(requestView)) };
        }),
      );
      return {
        groups: groups.filter((g) => g.requests.length),
        previous: this.page > 0,
        next: (this.page + 1) * 5 < requests.length,
      };
    }
    static previous(this: any): void {
      this.page--;
      void this.render();
    }
    static next(this: any): void {
      this.page++;
      void this.render();
    }

    static approve(_event: Event, target: HTMLElement): void {
      controller.resolve(target.dataset.requestId ?? '', { decision: 'approve', scope: 'once' });
    }
    static session(_event: Event, target: HTMLElement): void {
      controller.resolve(target.dataset.requestId ?? '', { decision: 'approve', scope: 'session' });
    }
    static deny(_event: Event, target: HTMLElement): void {
      const reason = target
        .closest('[data-request]')
        ?.querySelector<HTMLTextAreaElement>('[name="reason"]')
        ?.value.trim();
      if (!reason) {
        ui.notifications.warn(game.i18n.localize('AGENT_GATEWAY.ApprovalDialog.reasonRequired'));
        return;
      }
      controller.resolve(target.dataset.requestId ?? '', { decision: 'deny', reason });
    }
    static approveAll(this: any, _event: Event, target: HTMLElement): void {
      // Preparation may await document previews while an older button remains visible.
      // Bind the action to its committed DOM, never to mutable preparation state.
      if (!this.element?.isConnected || !this.element.contains(target)) return;
      if (target.dataset.action !== 'approveAll') return;
      const group = target.closest('.ag-approval-group');
      if (!group || !this.element.contains(group)) return;
      const rows = group.querySelectorAll<HTMLElement>('article[data-request]');
      if (!rows.length || rows.length > 5) return;
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        const id = row.dataset.request;
        if (!id || seen.has(id)) return;
        seen.add(id);
        const approve = row.querySelector<HTMLButtonElement>('[data-action="approve"]');
        if (approve && !approve.disabled && approve.dataset.requestId === id) ids.push(id);
      }
      // Snapshot before resolving: each resolution can synchronously request another render.
      for (const id of ids) controller.resolve(id, { decision: 'approve', scope: 'once' });
    }
  };
}

let controller: ApprovalUiController | undefined;
let app: any;

/** No eager manager/registry capture: both are bootstrapped through cyclic dispatcher imports. */
export function installApprovalUi(): void {
  controller ??= new ApprovalUiController({
    manager: () => getApprovalManager(),
    isGM: () => game.user?.isGM === true,
    now: () => Date.now(),
    on: (hook, callback) => {
      Hooks.on(hook, callback);
    },
    present: (groups) => {
      if (!groups.length) {
        if (app?.rendered) void app.close();
        return;
      }
      if (!app) {
        const App = createApprovalApp(controller!);
        app = new App();
      }
      app.groups = groups;
      void app.render({ force: true });
    },
  });
  controller.install();
}
