/* eslint-disable @typescript-eslint/no-explicit-any */
import { getApplicationV2, getHandlebarsApplicationMixin } from '../../compat/index.js';
import { getLinkClient } from '../../link/runtime.js';
import {
  ManageError,
  MANAGE_MIN_GATEWAY_VERSION,
  gatewaySupportsGrants,
  type InviteSummary,
  type PairingSummary,
} from '../../link/client.js';
import { effectiveFromSettings } from '../../link/gateway-url.js';
import {
  DEFAULT_TTL_MS,
  TTL_CHOICES,
  inviteRows,
  pairingRows,
  type InviteRow,
  type PairingRow,
  type UserChoice,
} from './model.js';

declare const game: any;
declare const ui: any;
declare const foundry: any;

const NS = 'agent-gateway';

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export type Tab = 'invites' | 'pairings';

export interface ManageContext {
  /** A localized reason the app cannot be used; empty when it can. */
  unavailable: string;
  tab: Tab;
  isInvites: boolean;
  isPairings: boolean;
  invites: InviteRow[];
  pairings: PairingRow[];
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

const blank = (tab: Tab, unavailable: string): ManageContext => ({
  unavailable,
  tab,
  isInvites: tab === 'invites',
  isPairings: tab === 'pairings',
  invites: [],
  pairings: [],
  users: [],
  ttls: [],
  emptyInvites: false,
  emptyPairings: false,
});

/** Why the app cannot be used right now, or '' when it can. Sends nothing. */
export function unavailableReason(): string {
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

function failureKey(e: unknown): string {
  const code = e instanceof ManageError ? e.code : '';
  if (code === 'TOO_OLD') return 'AGENT_GATEWAY.Manage.tooOld';
  if (code === 'OFFLINE') return 'AGENT_GATEWAY.Manage.offline';
  if (code === 'FORBIDDEN') return 'AGENT_GATEWAY.Manage.notAdmin';
  if (code === 'TIMEOUT') return 'AGENT_GATEWAY.Manage.timeout';
  return 'AGENT_GATEWAY.Manage.failed';
}

/** What the window shows for a tab. The one-time invite code is never part of it. */
export async function prepareManage(tab: Tab = 'invites'): Promise<ManageContext> {
  const i18n = game.i18n;
  const why = unavailableReason();
  if (why) return blank(tab, why);
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
    } else {
      const pairings: PairingSummary[] = await client.listPairings();
      ctx.pairings = pairingRows(pairings);
      ctx.emptyPairings = ctx.pairings.length === 0;
    }
    return ctx;
  } catch (e) {
    return blank(tab, i18n.localize(failureKey(e)));
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
        createInvite: ManageApp.onCreateInvite,
        cancelInvite: ManageApp.onCancelInvite,
        revokePairing: ManageApp.onRevokePairing,
      },
    };
    static PARTS = { body: { template: `modules/${NS}/templates/manage/manage.hbs` } };

    async _prepareContext(): Promise<object> {
      return prepareManage(this.tab);
    }

    static async onTab(this: any, _event: Event, target: HTMLElement): Promise<void> {
      const tab = target?.dataset?.tab;
      if (tab !== 'invites' && tab !== 'pairings') return;
      this.tab = tab;
      await this.render();
    }

    static async onCreateInvite(this: any, _event: Event, _target: HTMLElement): Promise<void> {
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
      if (!id || unavailableReason()) return;
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
