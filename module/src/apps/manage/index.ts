/* eslint-disable @typescript-eslint/no-explicit-any */
import { getApplicationV2, getHandlebarsApplicationMixin } from '../../compat/index.js';
import { getLinkClient } from '../../link/runtime.js';
import {
  ManageError,
  MANAGE_MIN_GATEWAY_VERSION,
  PAIRINGS_MIN_GATEWAY_VERSION,
  gatewaySupportsGrants,
  type InviteSummary,
  type PairingSummary,
} from '../../link/client.js';
import { effectiveFromSettings } from '../../link/gateway-url.js';
import {
  DEFAULT_TTL_MS,
  TTL_CHOICES,
  adminGrantRows,
  grantUsers,
  inviteRows,
  pairingRows,
  type AdminGrantRow,
  type GrantUserRow,
  type InviteRow,
  type PairingRow,
  type UserChoice,
} from './model.js';

declare const game: any;
declare const ui: any;
declare const foundry: any;

const NS = 'agent-gateway';

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export type Tab = 'invites' | 'pairings' | 'grants';

export interface ManageContext {
  /** A localized reason the app cannot be used; empty when it can. */
  unavailable: string;
  /** A localized failure of this tab alone; the tab nav stays and the notice shows in its panel. */
  notice: string;
  /** Whether the notice offers a retry. */
  canRetry: boolean;
  tab: Tab;
  isInvites: boolean;
  isPairings: boolean;
  isGrants: boolean;
  invites: InviteRow[];
  pairings: PairingRow[];
  /** Grants tab: the users whose apps can be viewed, one marked selected. */
  grantUsers: GrantUserRow[];
  selectedUserId: string;
  grants: AdminGrantRow[];
  emptyGrantUsers: boolean;
  emptyGrants: boolean;
  users: UserChoice[];
  ttls: Array<{ ms: number; label: string; selected: boolean }>;
  emptyInvites: boolean;
  emptyPairings: boolean;
}

const userList = (): any[] =>
  Array.isArray(game.users?.contents)
    ? game.users.contents
    : Array.from((game.users ?? []) as Iterable<any>);

function allUsers(): UserChoice[] {
  return userList().map((u) => ({ id: String(u.id), name: String(u.name ?? u.id) }));
}

/** The non-GM users of this world, whom an admin GM may invite. */
export function playerChoices(): UserChoice[] {
  return userList()
    .filter((u) => u && !u.isGM)
    .map((u) => ({ id: String(u.id), name: String(u.name ?? u.id) }));
}

const blank = (tab: Tab, unavailable: string, notice = '', canRetry = false): ManageContext => ({
  unavailable,
  notice,
  canRetry,
  tab,
  isInvites: tab === 'invites',
  isPairings: tab === 'pairings',
  isGrants: tab === 'grants',
  invites: [],
  pairings: [],
  grantUsers: [],
  selectedUserId: '',
  grants: [],
  emptyGrantUsers: false,
  emptyGrants: false,
  users: [],
  ttls: [],
  emptyInvites: false,
  emptyPairings: false,
});

/** Why the whole app cannot be used right now, or '' when it can. Sends nothing. */
export function appUnavailableReason(): string {
  const i18n = game.i18n;
  const client = getLinkClient() as any;
  const state = client.state;
  if (state.kind === 'disconnected' && state.reason === 'PROTOCOL_MAJOR_MISMATCH')
    return i18n.localize('AGENT_GATEWAY.Manage.tooOld');
  if (state.kind !== 'connected') return i18n.localize('AGENT_GATEWAY.Manage.offline');
  if (!client.isAdmin) return i18n.localize('AGENT_GATEWAY.Manage.notAdmin');
  if (!gatewaySupportsGrants(client.gatewayVersion, MANAGE_MIN_GATEWAY_VERSION))
    return i18n.localize('AGENT_GATEWAY.Manage.tooOld');
  return '';
}

/** Why this tab alone cannot be used (a gateway too old for it), or ''. Sends nothing. */
export function tabUnavailableReason(tab: Tab): string {
  const client = getLinkClient() as any;
  if (
    (tab === 'pairings' || tab === 'grants') &&
    !gatewaySupportsGrants(client.gatewayVersion, PAIRINGS_MIN_GATEWAY_VERSION)
  )
    return game.i18n.localize('AGENT_GATEWAY.Manage.tooOld');
  return '';
}

/** Why the tab's action cannot run right now, or '' when it can. Sends nothing. */
export function unavailableReason(tab: Tab = 'invites'): string {
  return appUnavailableReason() || tabUnavailableReason(tab);
}

function failureKey(e: unknown): string {
  const code = e instanceof ManageError ? e.code : '';
  if (code === 'TOO_OLD') return 'AGENT_GATEWAY.Manage.tooOld';
  if (code === 'OFFLINE') return 'AGENT_GATEWAY.Manage.offline';
  if (code === 'FORBIDDEN') return 'AGENT_GATEWAY.Manage.notAdmin';
  if (code === 'TIMEOUT') return 'AGENT_GATEWAY.Manage.timeout';
  return 'AGENT_GATEWAY.Manage.failed';
}

/** What the window shows for a tab. The one-time invite code is never part of it. */
export async function prepareManage(tab: Tab = 'invites', userId?: string): Promise<ManageContext> {
  const i18n = game.i18n;
  const why = appUnavailableReason();
  if (why) return blank(tab, why);
  const tabWhy = tabUnavailableReason(tab);
  if (tabWhy) return blank(tab, '', tabWhy);
  const client = getLinkClient() as any;
  try {
    const ctx = blank(tab, '');
    if (tab === 'invites') {
      const invites: InviteSummary[] = await client.listInvites();
      ctx.invites = inviteRows(invites, allUsers(), (s) =>
        i18n.localize(`AGENT_GATEWAY.Manage.status.${s}`),
      );
      ctx.emptyInvites = ctx.invites.length === 0;
      ctx.users = playerChoices();
      ctx.ttls = TTL_CHOICES.map((t) => ({
        ms: t.ms,
        label: i18n.localize(`AGENT_GATEWAY.Manage.${t.key}`),
        selected: t.ms === DEFAULT_TTL_MS,
      }));
    } else if (tab === 'grants') {
      const pairings: PairingSummary[] = await client.listPairings();
      ctx.grantUsers = grantUsers(pairings, userId);
      ctx.emptyGrantUsers = ctx.grantUsers.length === 0;
      const picked = ctx.grantUsers.find((u) => u.selected);
      if (picked) {
        ctx.selectedUserId = picked.id;
        ctx.grants = adminGrantRows(await client.listUserGrants(picked.id));
        ctx.emptyGrants = ctx.grants.length === 0;
      }
    } else {
      const pairings: PairingSummary[] = await client.listPairings();
      ctx.pairings = pairingRows(pairings);
      ctx.emptyPairings = ctx.pairings.length === 0;
    }
    return ctx;
  } catch (e) {
    const key = failureKey(e);
    // Offline is a whole-app state; every other failure belongs to this tab.
    if (key === 'AGENT_GATEWAY.Manage.offline') return blank(tab, i18n.localize(key));
    return blank(tab, '', i18n.localize(key), key === 'AGENT_GATEWAY.Manage.timeout');
  }
}

/** The text a player pastes: the effective gateway URL, `#`, the code. */
export function inviteLink(code: string): string {
  return `${effectiveFromSettings((key) => game.settings.get(NS, key))}#${code}`;
}

/**
 * Show a new invite code once, in a dialog. Everything interpolated is escaped. The code is held
 * only by this dialog: it is not logged, notified, stored or kept for the next render.
 */
export function showInviteCode(code: string): void {
  const i18n = game.i18n;
  const link = inviteLink(code);
  const content =
    `<p>${escapeHtml(i18n.localize('AGENT_GATEWAY.Manage.codeIntro'))}</p>` +
    `<p><input type="text" readonly class="agent-gateway-invite-link" value="${escapeHtml(link)}"></p>` +
    `<p><button type="button" class="agent-gateway-copy">${escapeHtml(i18n.localize('AGENT_GATEWAY.Manage.copy'))}</button></p>` +
    `<p class="notes">${escapeHtml(i18n.localize('AGENT_GATEWAY.Manage.codeOnce'))}</p>`;
  void foundry.applications.api.DialogV2.prompt({
    window: { title: i18n.localize('AGENT_GATEWAY.Manage.codeTitle') },
    content,
    ok: { label: i18n.localize('AGENT_GATEWAY.Manage.close') },
    rejectClose: false,
    render: (_event: Event, dialog: any) => {
      const root: HTMLElement | undefined = dialog?.element ?? dialog;
      root?.querySelector?.('.agent-gateway-copy')?.addEventListener('click', () => {
        void (globalThis as any).navigator?.clipboard?.writeText?.(link)?.catch?.(() => undefined);
      });
    },
  }).catch(() => undefined);
}

async function confirmSelfRevoke(): Promise<boolean> {
  const i18n = game.i18n;
  try {
    return !!(await foundry.applications.api.DialogV2.confirm({
      window: { title: i18n.localize('AGENT_GATEWAY.Manage.revokeSelfTitle') },
      content: `<p>${escapeHtml(i18n.localize('AGENT_GATEWAY.Manage.revokeSelfBody'))}</p>`,
      rejectClose: false,
    }));
  } catch {
    return false;
  }
}

/** Built lazily: the ApplicationV2 base class only exists once Foundry has initialised. */
export function createManageApp(): any {
  const Base = getHandlebarsApplicationMixin()(getApplicationV2());

  class ManageApp extends Base {
    tab: Tab = 'invites';
    /** The user whose apps the Grants tab shows; unset means the first listed. */
    grantUser: string | undefined;
    static DEFAULT_OPTIONS = {
      id: 'agent-gateway-manage',
      window: {
        title: 'AGENT_GATEWAY.Manage.title',
        icon: 'fa-solid fa-user-shield',
        resizable: true,
      },
      position: { width: 640 },
      actions: {
        tab: ManageApp.onTab,
        retry: ManageApp.onRetry,
        createInvite: ManageApp.onCreateInvite,
        cancelInvite: ManageApp.onCancelInvite,
        revokePairing: ManageApp.onRevokePairing,
        selectGrantUser: ManageApp.onSelectGrantUser,
        revokeUserGrant: ManageApp.onRevokeUserGrant,
      },
    };
    static PARTS = { body: { template: `modules/${NS}/templates/manage/manage.hbs` } };

    async _prepareContext(): Promise<object> {
      return prepareManage(this.tab, this.grantUser);
    }

    static async onSelectGrantUser(this: any, _event: Event, target: HTMLElement): Promise<void> {
      const userId = target?.dataset?.userId;
      if (!userId) return;
      this.grantUser = userId;
      await this.render();
    }

    static async onRevokeUserGrant(this: any, _event: Event, target: HTMLElement): Promise<void> {
      const userId = target?.dataset?.userId;
      const grantId = target?.dataset?.grantId;
      if (!userId || !grantId || unavailableReason('grants')) return;
      try {
        await getLinkClient().revokeUserGrant(userId, grantId);
        ui.notifications.info(game.i18n.localize('AGENT_GATEWAY.Manage.grantRevoked'));
      } catch (e) {
        ui.notifications.warn(game.i18n.localize(failureKey(e)));
      }
      await this.render();
    }

    static async onTab(this: any, _event: Event, target: HTMLElement): Promise<void> {
      const tab = target?.dataset?.tab;
      if (tab !== 'invites' && tab !== 'pairings' && tab !== 'grants') return;
      this.tab = tab;
      await this.render();
    }

    static async onRetry(this: any): Promise<void> {
      await this.render();
    }

    static async onCreateInvite(this: any): Promise<void> {
      if (unavailableReason()) return;
      const root: HTMLElement | undefined = this.element;
      const userId = (root?.querySelector?.('[name="userId"]') as any)?.value;
      const ttl = Number((root?.querySelector?.('[name="ttlMs"]') as any)?.value);
      if (!userId || !playerChoices().some((u) => u.id === userId)) return;
      try {
        const made = await getLinkClient().createInvite(
          userId,
          TTL_CHOICES.some((t) => t.ms === ttl) ? ttl : DEFAULT_TTL_MS,
        );
        showInviteCode(made.code);
      } catch (e) {
        ui.notifications.warn(game.i18n.localize(failureKey(e)));
      }
      await this.render();
    }

    static async onCancelInvite(this: any, _event: Event, target: HTMLElement): Promise<void> {
      const id = target?.dataset?.inviteId;
      if (!id || unavailableReason()) return;
      try {
        await getLinkClient().cancelInvite(id);
        ui.notifications.info(game.i18n.localize('AGENT_GATEWAY.Manage.cancelled'));
      } catch (e) {
        ui.notifications.warn(game.i18n.localize(failureKey(e)));
      }
      await this.render();
    }

    static async onRevokePairing(this: any, _event: Event, target: HTMLElement): Promise<void> {
      const id = target?.dataset?.pairingId;
      if (!id || unavailableReason('pairings')) return;
      // Another admin GM's row has a disabled button; refuse here too if the attribute is forged.
      if (target.dataset.canRevoke !== 'true') return;
      if (target.dataset.self === 'true' && !(await confirmSelfRevoke())) return;
      try {
        await getLinkClient().revokePairing(id);
        ui.notifications.info(game.i18n.localize('AGENT_GATEWAY.Manage.revoked'));
      } catch (e) {
        ui.notifications.warn(game.i18n.localize(failureKey(e)));
      }
      await this.render();
    }
  }
  return ManageApp;
}

let appClass: any = null;

/** The one ManageApp class, built on first use. */
export function getManageAppClass(): any {
  appClass ??= createManageApp();
  return appClass;
}

/** Settings registrar: the GM-only menu that opens the management app. */
export function registerManageMenu(): void {
  game.settings.registerMenu(NS, 'manage', {
    name: 'AGENT_GATEWAY.Manage.menu.name',
    label: 'AGENT_GATEWAY.Manage.menu.label',
    hint: 'AGENT_GATEWAY.Manage.menu.hint',
    icon: 'fa-solid fa-user-shield',
    type: getManageAppClass(),
    restricted: true,
  });
}
