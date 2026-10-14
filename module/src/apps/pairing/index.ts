/* eslint-disable @typescript-eslint/no-explicit-any */
import { getApplicationV2, getHandlebarsApplicationMixin } from '../../compat/index.js';
import { getLinkClient } from '../../link/runtime.js';
import { normalizeGatewayUrl, type LinkState } from '../../link/client.js';
import {
  displayAddress,
  isServerModeUrl,
  LEGACY_DEFAULT_URL,
  readGatewayResolution,
  resolveGateway,
  validWorldDefault,
  type GatewayResolution,
} from '../../link/gateway-url.js';
import { parsePairingInput, type PairingInput } from '../../link/invite-string.js';

declare const game: any;
declare const ui: any;

const NS = 'agent-gateway';

/** This browser's world and user ids, which the operator needs for `--invite`. */
export function currentIds(): { worldId: string; userId: string } {
  return { worldId: String(game.world?.id ?? ''), userId: String(game.user?.id ?? '') };
}

/** What the copy button puts on the clipboard: the ids in `--invite <world id> <user id>` order. */
export function idsClipboardText(): string {
  const { worldId, userId } = currentIds();
  return `${worldId} ${userId}`;
}

/** Server mode wording says "invite"; local mode keeps the existing "pairing code" strings. */
export function describeState(s: LinkState, serverMode = false): string {
  const i18n = game.i18n;
  const invalid = serverMode
    ? 'AGENT_GATEWAY.Pairing.Server.pairingInvalid'
    : 'AGENT_GATEWAY.Link.pairingInvalid';
  const required = serverMode
    ? 'AGENT_GATEWAY.Pairing.Server.pairingRequired'
    : 'AGENT_GATEWAY.Link.pairingRequired';
  switch (s.kind) {
    case 'connecting':
      if (s.codeRejected) return i18n.localize(invalid);
      return i18n.localize('AGENT_GATEWAY.Link.state.connecting');
    case 'connected':
      return i18n.format('AGENT_GATEWAY.Link.state.connected', { user: s.user, world: s.world });
    default:
      if (s.reason === 'REPLACED') return i18n.localize('AGENT_GATEWAY.Link.replaced');
      if (s.reason === 'TOKEN_REJECTED') return i18n.localize('AGENT_GATEWAY.Link.tokenRejected');
      if (s.reason === 'PAIRING_REQUIRED') return i18n.localize(required);
      return s.reason === 'PAIRING_INVALID'
        ? i18n.localize(invalid)
        : i18n.localize('AGENT_GATEWAY.Link.state.disconnected');
  }
}

/** The client and world gateway settings, resolved to the address the link will use. */
function currentGateway(): GatewayResolution {
  return readGatewayResolution((key) => game.settings.get(NS, key));
}

/** The address line: what the window is trying to reach, in display-safe form. */
export function describeAddress(s: LinkState, res: GatewayResolution): string {
  const i18n = game.i18n;
  const address = displayAddress(res.url);
  if (s.kind === 'connecting')
    return i18n.format('AGENT_GATEWAY.Pairing.Address.connecting', { address });
  if (s.kind === 'disconnected' && s.reason === 'ERROR')
    return i18n.format('AGENT_GATEWAY.Pairing.Address.unreachable', { address });
  return i18n.format(
    res.source === 'world'
      ? 'AGENT_GATEWAY.Pairing.Address.inherited'
      : 'AGENT_GATEWAY.Pairing.Address.current',
    { address },
  );
}

/** The player's choice is stored empty when it equals the world default, so later changes apply. */
function storedOverride(typed: string): string {
  if (typed === '') return '';
  const world = validWorldDefault((key) => game.settings.get(NS, key));
  return world !== '' && normalizeGatewayUrl(typed) === normalizeGatewayUrl(world) ? '' : typed;
}

/** Redeem a parsed invite: store the address (awaited, so the code is recorded against it), then pair. */
export async function redeemInvite(invite: { url: string; code: string }): Promise<void> {
  await game.settings.set(NS, 'gatewayUrl', storedOverride(invite.url));
  getLinkClient().pair(invite.code);
}

/** Built lazily: the ApplicationV2 base class only exists once Foundry has initialised. */
export function createPairingApp(): any {
  const Base = getHandlebarsApplicationMixin()(getApplicationV2());

  class PairingApp extends Base {
    static DEFAULT_OPTIONS = {
      id: 'agent-gateway-pairing',
      tag: 'form',
      window: { title: 'AGENT_GATEWAY.Pairing.title', icon: 'fa-solid fa-link' },
      position: { width: 420 },
      form: { handler: PairingApp.onSubmit, closeOnSubmit: false },
      actions: { copyIds: PairingApp.onCopyIds, unpair: PairingApp.onUnpair },
    };
    static PARTS = { form: { template: `modules/${NS}/templates/pairing/pairing.hbs` } };

    private unsubscribe: (() => void) | null = null;
    private static current: any = null;

    constructor(...args: any[]) {
      // A second menu click while open brings the existing window to front.
      const open = PairingApp.current;
      if (open?.rendered) {
        open.bringToFront?.();
        return open;
      }
      super(...args);
      PairingApp.current = this;
    }

    async _prepareContext(): Promise<object> {
      const res = currentGateway();
      const serverMode = isServerModeUrl(res.url);
      const raw = String(game.settings.get(NS, 'gatewayUrl'));
      const i18n = game.i18n;
      const state = getLinkClient().state;
      return {
        // A stored legacy default reads as "inherit" while the world default applies.
        gatewayUrl: raw.trim() === LEGACY_DEFAULT_URL && res.source === 'world' ? '' : raw,
        status: describeState(state, serverMode),
        address: describeAddress(state, res),
        serverMode,
        codeLabel: i18n.localize(
          serverMode ? 'AGENT_GATEWAY.Pairing.Invite.label' : 'AGENT_GATEWAY.Pairing.code',
        ),
        codeHint: i18n.localize(
          serverMode ? 'AGENT_GATEWAY.Pairing.Invite.hint' : 'AGENT_GATEWAY.Pairing.codeHint',
        ),
        // Only the current user's own pairing counts; another user's token in this browser never shows.
        paired: getLinkClient().hasCurrentGatewayToken?.() === true,
        onePairingNotice: i18n.localize('AGENT_GATEWAY.Pairing.OnePerUser.notice'),
        serverLine: serverMode ? i18n.localize('AGENT_GATEWAY.Pairing.Server.line') : '',
        urlWarning: res.clientInvalid ? i18n.localize('AGENT_GATEWAY.Pairing.Address.invalid') : '',
        worldWarning:
          res.worldInvalid && game.user?.isGM
            ? i18n.localize('AGENT_GATEWAY.Pairing.Address.worldInvalid')
            : '',
        idsText: game.i18n.format('AGENT_GATEWAY.Pairing.CopyIds.label', {
          world: currentIds().worldId,
          user: currentIds().userId,
        }),
      };
    }

    async _onRender(context: object, options: object): Promise<void> {
      await super._onRender?.(context, options);
      this.unsubscribe ??= getLinkClient().onState(() => this.updateStatus());
    }

    /** Refresh only the status and address lines; a full render would wipe what the user is typing. */
    private updateStatus(): void {
      const res = currentGateway();
      const state = getLinkClient().state;
      const el = this.element?.querySelector?.('[data-role="status"]');
      if (el) el.textContent = describeState(state, isServerModeUrl(res.url));
      const addr = this.element?.querySelector?.('[data-role="address"]');
      if (addr) addr.textContent = describeAddress(state, res);
    }

    async _onClose(options: object): Promise<void> {
      this.unsubscribe?.();
      this.unsubscribe = null;
      await super._onClose?.(options);
    }

    static async onUnpair(): Promise<void> {
      await getLinkClient().unpair();
      PairingApp.current?.render?.();
    }

    static async onCopyIds(): Promise<void> {
      try {
        await navigator.clipboard.writeText(idsClipboardText());
        ui.notifications.info(game.i18n.localize('AGENT_GATEWAY.Pairing.CopyIds.copied'));
      } catch {
        ui.notifications.warn(game.i18n.localize('AGENT_GATEWAY.Pairing.CopyIds.failed'));
      }
    }

    static async onSubmit(_event: Event, _form: HTMLFormElement, data: any): Promise<void> {
      const values = data?.object ?? {};
      const url = String(values.gatewayUrl ?? '').trim();
      const code = String(values.code ?? '').trim();
      const warn = (key: string): void => ui.notifications.warn(game.i18n.localize(key));

      // Whatever was pasted goes through the parser first: the code field, then the URL field.
      // A typed address has no '#', so only a URL field that has one is read as an invite string.
      let pasted: PairingInput | undefined;
      if (code) pasted = parsePairingInput(code);
      if (pasted?.kind !== 'invite' && pasted?.kind !== 'invalid' && url.includes('#'))
        pasted = parsePairingInput(url);
      if (pasted?.kind === 'invalid') {
        warn('AGENT_GATEWAY.Pairing.Invite.invalid');
        return;
      }
      if (pasted?.kind === 'invite') {
        await redeemInvite(pasted);
        return;
      }

      if (url && resolveGateway(url, '').clientInvalid) {
        warn('AGENT_GATEWAY.Pairing.Address.invalid');
        return;
      }
      // Always keep the edited URL; nothing is sent without a credential issued by it.
      await game.settings.set(NS, 'gatewayUrl', storedOverride(url));
      const needCode = isServerModeUrl(currentGateway().url)
        ? 'AGENT_GATEWAY.Pairing.Server.codeRequired'
        : 'AGENT_GATEWAY.Link.codeRequired';
      if (pasted?.kind === 'code') {
        getLinkClient().pair(pasted.code);
        return;
      }
      if (getLinkClient().hasStoredToken()) {
        // No new code: reclaim the link with the stored token. The client sends it only
        // to the gateway that issued it; for any other URL it asks for a pairing code.
        getLinkClient().start();
        const after = getLinkClient().state;
        // A PAIRING_REQUIRED status is already visible in the app; do not also toast it.
        if (after.kind === 'disconnected' && after.reason !== 'PAIRING_REQUIRED') warn(needCode);
        return;
      }
      warn(needCode);
    }
  }
  return PairingApp;
}

let appClass: any = null;

/** The one PairingApp class, built on first use. */
export function getPairingAppClass(): any {
  appClass ??= createPairingApp();
  return appClass;
}

/** Settings registrar: a menu entry that opens the pairing app (Foundry does `new type().render(true)`). */
export function registerPairingMenu(): void {
  game.settings.registerMenu(NS, 'pairing', {
    name: 'AGENT_GATEWAY.Pairing.menu.name',
    label: 'AGENT_GATEWAY.Pairing.menu.label',
    hint: 'AGENT_GATEWAY.Pairing.menu.hint',
    icon: 'fa-solid fa-link',
    type: getPairingAppClass(),
    restricted: false,
  });
}
