import { installPackApi, registerPacks, sealPacks } from './packs/live.js';
import { foundryGeneration } from './compat/index.js';
import { installBridge } from './link/bridge.js';
import {
  getLinkClient,
  isLinkActive,
  refreshToolset,
  resumeLink,
  startLink,
  stopLink,
} from './link/runtime.js';
import { onPolicyChange } from './policy/store.js';
import { registerSettings } from './settings/index.js';

declare const Hooks: {
  once(hook: string, fn: () => void): void;
  on(hook: string, fn: (user: { id?: string }) => void): void;
};
declare const game: { user?: { id?: string } } | undefined;

Hooks.once('init', () => {
  installPackApi();
  registerSettings();
});

Hooks.once('setup', registerPacks);

Hooks.once('ready', () => {
  sealPacks();
  console.log(`agent-gateway | ready (v${foundryGeneration()})`);
  installBridge(getLinkClient());
  // Role changes and policy edits change what this user may call; tell the gateway.
  Hooks.on('updateUser', (user: { id?: string }) => {
    if (user?.id === game?.user?.id) refreshToolset();
  });
  onPolicyChange(refreshToolset);
  startLink();
  const g = globalThis as {
    addEventListener?: (t: string, f: (e: { persisted?: boolean }) => void) => void;
  };
  let wasActive = false;
  g.addEventListener?.('pagehide', () => {
    wasActive = isLinkActive();
    // A replaced/stopped link keeps its terminal state (stop() would wipe REPLACED).
    if (wasActive) stopLink();
  });
  g.addEventListener?.('pageshow', (e) => {
    // Only a link that was live at pagehide comes back; a replaced/stopped one stays down.
    if (e.persisted === true && wasActive) {
      wasActive = false;
      resumeLink();
    }
  });
});
