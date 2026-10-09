import { foundryGeneration } from './compat/index.js';
import { isLinkActive, startLink, stopLink } from './link/runtime.js';
import { registerSettings } from './settings/index.js';

declare const Hooks: { once(hook: string, fn: () => void): void };

Hooks.once('init', () => {
  registerSettings();
});

Hooks.once('ready', () => {
  console.log(`agent-gateway | ready (v${foundryGeneration()})`);
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
      startLink();
    }
  });
});
