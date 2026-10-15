/* eslint-disable @typescript-eslint/no-explicit-any */
import { getApplicationV2, getHandlebarsApplicationMixin } from '../../compat/index.js';
import { getLinkClient } from '../../link/runtime.js';
import { gatewaySupportsGrants, type ConsentCodeMessage } from '../../link/client.js';
import { grantRows, type GrantRow } from './model.js';

declare const game: any;
declare const ui: any;
declare const foundry: any;
declare const Hooks: any;

const NS = 'agent-gateway';

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export type GrantsContext =
  | { unavailable: string; rows: GrantRow[]; empty: false }
  | { unavailable: ''; rows: GrantRow[]; empty: boolean };

/** What the window shows: this user's grants, or why they cannot be listed. */
export async function prepareGrants(): Promise<GrantsContext> {
  const i18n = game.i18n;
  const client = getLinkClient();
  if (client.state.kind !== 'connected')
    return { unavailable: i18n.localize('AGENT_GATEWAY.Grants.offline'), rows: [], empty: false };
  if (!gatewaySupportsGrants(client.gatewayVersion))
    return { unavailable: i18n.localize('AGENT_GATEWAY.Grants.tooOld'), rows: [], empty: false };
  try {
    const rows = grantRows(await client.listGrants());
    return { unavailable: '', rows, empty: rows.length === 0 };
  } catch {
    return { unavailable: i18n.localize('AGENT_GATEWAY.Grants.failed'), rows: [], empty: false };
  }
}

/** Show a consent code to its user. Everything interpolated is escaped. */
export function showConsentCode(m: ConsentCodeMessage): void {
  const i18n = game.i18n;
  const content =
    `<p>${escapeHtml(
      m.forAgent
        ? i18n.format('AGENT_GATEWAY.Consent.promptAgent', {
            client: m.clientName,
            agent: m.forAgent.name,
          })
        : i18n.format('AGENT_GATEWAY.Consent.prompt', { client: m.clientName }),
    )}</p>` +
    `<p class="agent-gateway-consent-code"><strong>${escapeHtml(m.code)}</strong></p>` +
    `<p>${escapeHtml(i18n.format('AGENT_GATEWAY.Consent.scopes', { scopes: m.scopes.join(', ') }))}</p>` +
    `<p>${escapeHtml(i18n.localize('AGENT_GATEWAY.Consent.hint'))}</p>`;
  void foundry.applications.api.DialogV2.prompt({
    window: { title: i18n.localize('AGENT_GATEWAY.Consent.title') },
    content,
    ok: { label: i18n.localize('AGENT_GATEWAY.Consent.dismiss') },
    rejectClose: false,
  }).catch(() => undefined);
}

/** Built lazily: the ApplicationV2 base class only exists once Foundry has initialised. */
export function createGrantsApp(): any {
  const Base = getHandlebarsApplicationMixin()(getApplicationV2());

  class GrantsApp extends Base {
    static DEFAULT_OPTIONS = {
      id: 'agent-gateway-grants',
      window: { title: 'AGENT_GATEWAY.Grants.title', icon: 'fa-solid fa-key', resizable: true },
      position: { width: 560 },
      actions: { revoke: GrantsApp.onRevoke },
    };
    static PARTS = { list: { template: `modules/${NS}/templates/grants/grants.hbs` } };

    async _prepareContext(): Promise<object> {
      return prepareGrants();
    }

    static async onRevoke(this: any, _event: Event, target: HTMLElement): Promise<void> {
      const id = target?.dataset?.grantId;
      if (!id) return;
      try {
        await getLinkClient().revokeGrant(id);
        ui.notifications.info(game.i18n.localize('AGENT_GATEWAY.Grants.revoked'));
      } catch {
        ui.notifications.warn(game.i18n.localize('AGENT_GATEWAY.Grants.failed'));
      }
      await this.render();
    }
  }
  return GrantsApp;
}

let appClass: any = null;

/** The one GrantsApp class, built on first use. */
export function getGrantsAppClass(): any {
  appClass ??= createGrantsApp();
  return appClass;
}

/** Settings registrar: the menu that opens the grants app, and the consent-code prompt at ready. */
export function registerGrantsMenu(): void {
  game.settings.registerMenu(NS, 'grants', {
    name: 'AGENT_GATEWAY.Grants.menu.name',
    label: 'AGENT_GATEWAY.Grants.menu.label',
    hint: 'AGENT_GATEWAY.Grants.menu.hint',
    icon: 'fa-solid fa-key',
    type: getGrantsAppClass(),
    restricted: false,
  });
  // The link client is created at ready, not at init, as the approval queue does.
  if (typeof Hooks !== 'undefined' && typeof Hooks.once === 'function')
    Hooks.once('ready', () => {
      getLinkClient().onConsentCode?.(showConsentCode);
    });
}
