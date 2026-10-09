/* eslint-disable @typescript-eslint/no-explicit-any */
import { getApplicationV2, getHandlebarsApplicationMixin } from '../../compat/index.js';
import { getLinkClient } from '../../link/runtime.js';
import type { LinkState } from '../../link/client.js';

declare const game: any;

const NS = 'agent-gateway';

export function describeState(s: LinkState): string {
  const i18n = game.i18n;
  switch (s.kind) {
    case 'connecting':
      return i18n.localize('AGENT_GATEWAY.Link.state.connecting');
    case 'connected':
      return i18n.format('AGENT_GATEWAY.Link.state.connected', { user: s.user, world: s.world });
    default:
      return s.reason === 'PAIRING_INVALID'
        ? i18n.localize('AGENT_GATEWAY.Link.pairingInvalid')
        : i18n.localize('AGENT_GATEWAY.Link.state.disconnected');
  }
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
    };
    static PARTS = { form: { template: `modules/${NS}/templates/pairing/pairing.hbs` } };

    private unsubscribe: (() => void) | null = null;

    async _prepareContext(): Promise<object> {
      return {
        gatewayUrl: String(game.settings.get(NS, 'gatewayUrl')),
        status: describeState(getLinkClient().state),
      };
    }

    async _onRender(context: object, options: object): Promise<void> {
      await super._onRender?.(context, options);
      this.unsubscribe ??= getLinkClient().onState(() => void this.render());
    }

    async _onClose(options: object): Promise<void> {
      this.unsubscribe?.();
      this.unsubscribe = null;
      await super._onClose?.(options);
    }

    static async onSubmit(_event: Event, _form: HTMLFormElement, data: any): Promise<void> {
      const values = data?.object ?? {};
      const url = String(values.gatewayUrl ?? '').trim();
      const code = String(values.code ?? '').trim();
      if (!url || !code) return;
      await game.settings.set(NS, 'gatewayUrl', url);
      getLinkClient().pair(code);
    }
  }
  return PairingApp;
}

let instance: any = null;

export function openPairingApp(): void {
  instance ??= new (createPairingApp())();
  void instance.render({ force: true });
}

/** Settings registrar: a menu entry that opens the pairing app. */
export function registerPairingMenu(): void {
  const settings = game.settings;
  if (typeof settings.registerMenu !== 'function') return;
  class PairingMenu {
    constructor() {
      openPairingApp();
    }
    render(): void {}
  }
  settings.registerMenu(NS, 'pairing', {
    name: 'AGENT_GATEWAY.Pairing.menu.name',
    label: 'AGENT_GATEWAY.Pairing.menu.label',
    hint: 'AGENT_GATEWAY.Pairing.menu.hint',
    icon: 'fa-solid fa-link',
    type: PairingMenu,
    restricted: false,
  });
}
