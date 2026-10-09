/* eslint-disable @typescript-eslint/no-explicit-any */
import { LinkClient } from './client.js';

declare const game: any;
declare const ui: any;

const NS = 'agent-gateway';

let client: LinkClient | null = null;

/** The single per-client link; created on first use. */
export function getLinkClient(): LinkClient {
  client ??= new LinkClient({
    getGatewayUrl: () => String(game.settings.get(NS, 'gatewayUrl')),
    getToken: () => String(game.settings.get(NS, 'pairingToken') ?? ''),
    setToken: (t) => game.settings.set(NS, 'pairingToken', t),
    getIdentity: () => ({
      moduleVersion: String(game.modules?.get(NS)?.version ?? '0.0.0'),
      foundryVersion: String(game.version ?? game.data?.version ?? ''),
      world: {
        id: String(game.world?.id ?? ''),
        title: String(game.world?.title ?? ''),
        system: String(game.system?.id ?? ''),
        systemVersion: String(game.system?.version ?? ''),
      },
      user: {
        id: String(game.user?.id ?? ''),
        name: String(game.user?.name ?? ''),
        role: Number(game.user?.role ?? 0),
        isGM: Boolean(game.user?.isGM),
      },
    }),
    createSocket: (url) => new WebSocket(url) as any,
    notifyError: (m) => ui.notifications.error(m),
  });
  return client;
}

export function startLink(): void {
  getLinkClient().start();
}

export function stopLink(): void {
  client?.stop();
}

export function isLinkActive(): boolean {
  return client?.isActive ?? false;
}
