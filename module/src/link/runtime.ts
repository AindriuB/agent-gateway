import {
  installOfflineEventPolicy,
  onOfflineEventSettingChange,
} from '../events/offline-setting.js';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { liveInputs } from '../policy/stage.js';
import { LinkClient } from './client.js';
import {
  installToolsetAnnouncer,
  policyDenies,
  policyAllowsEventReads,
  type ToolsetAnnouncer,
} from './toolset.js';

declare const game: any;
declare const ui: any;

const NS = 'agent-gateway';

let client: LinkClient | null = null;
let announcer: ToolsetAnnouncer | null = null;

/**
 * The old `pairingToken` string is not tied to any gateway, so it is never sent: clear it
 * once, when the link is first created.
 */
function clearLegacyToken(): void {
  try {
    if (game.settings.get(NS, 'pairingToken')) void game.settings.set(NS, 'pairingToken', '');
  } catch {
    // Setting not registered: nothing to clear.
  }
}

/** The single per-client link; created on first use. */
export function getLinkClient(): LinkClient {
  if (!client) clearLegacyToken();
  client ??= new LinkClient({
    getGatewayUrl: () => String(game.settings.get(NS, 'gatewayUrl')),
    getToken: () => game.settings.get(NS, 'pairingCredential'),
    setToken: (c) =>
      game.settings.set(
        NS,
        'pairingCredential',
        c ? JSON.stringify({ url: c.url, token: c.token }) : '',
      ),
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
        // The gateway refuses a hello whose name is over 100 characters.
        name: String(game.user?.name ?? '').slice(0, 100),
        role: Number(game.user?.role ?? 0),
        isGM: Boolean(game.user?.isGM),
      },
    }),
    createSocket: (url) => new WebSocket(url) as any,
    notifyError: (m) => ui.notifications.error(m),
  });
  announcer ??= installToolsetAnnouncer(client, {
    isGM: () => Boolean(game.user?.isGM),
    isCategoryDenied: policyDenies(liveInputs, () => Boolean(game.user?.isGM)),
    eventReadAllowed: policyAllowsEventReads(liveInputs, () => Boolean(game.user?.isGM)),
  });
  const refreshOffline = installOfflineEventPolicy(client);
  onOfflineEventSettingChange(refreshOffline);
  return client;
}

/** Re-announce the tool set if it changed: a role change or a policy setting edit. */
export function refreshToolset(): void {
  announcer?.refresh();
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

export function resumeLink(): void {
  client?.resume();
}
