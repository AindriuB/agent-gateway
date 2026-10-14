import {
  installOfflineEventPolicy,
  onOfflineEventSettingChange,
} from '../events/offline-setting.js';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { liveInputs } from '../policy/stage.js';
import { LinkClient, type TokenOwner } from './client.js';
import {
  createCredentialStore,
  memoryStorage,
  type CredentialOwner,
  type CredentialStore,
} from './credential-store.js';
import { effectiveFromSettings } from './gateway-url.js';
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
let store: CredentialStore | null = null;

/** Browser-local only; if the browser blocks storage, tokens live in memory for this page. */
function credentials(): CredentialStore {
  if (!store) {
    let storage;
    try {
      storage = globalThis.localStorage ?? memoryStorage();
    } catch {
      storage = memoryStorage();
    }
    store = createCredentialStore(storage);
  }
  return store;
}

const owner = (owner?: TokenOwner): Omit<CredentialOwner, 'url'> => ({
  worldId: owner?.worldId ?? String(game.world?.id ?? ''),
  userId: owner?.userId ?? String(game.user?.id ?? ''),
});
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
    getGatewayUrl: () => effectiveFromSettings((key) => game.settings.get(NS, key)),
    // The gateway URL is part of the key, so the stored entry is looked up per effective URL.
    getToken: () => {
      const url = effectiveFromSettings((key) => game.settings.get(NS, key));
      const token = credentials().get({ url, ...owner() });
      return token ? { url, token } : null;
    },
    setToken: (c, o) => {
      const url = c?.url ?? effectiveFromSettings((key) => game.settings.get(NS, key));
      if (c) credentials().set({ url, ...owner(o) }, c.token);
      else credentials().remove({ url, ...owner(o) });
    },
    touchToken: (o) =>
      credentials().touch({
        url: effectiveFromSettings((key) => game.settings.get(NS, key)),
        ...owner(o),
      }),
    hasOtherTokens: () => credentials().size() > 0,
    getLegacyToken: () => {
      try {
        return game.settings.get(NS, 'pairingCredential');
      } catch {
        return '';
      }
    },
    clearLegacyToken: () => {
      try {
        return game.settings.set(NS, 'pairingCredential', '');
      } catch {
        return undefined;
      }
    },
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
