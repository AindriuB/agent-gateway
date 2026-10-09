import { foundryGeneration } from './compat/index.js';
import { startLink, stopLink } from './link/runtime.js';
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
  g.addEventListener?.('pagehide', () => stopLink());
  g.addEventListener?.('pageshow', (e) => {
    if (e.persisted === true) startLink();
  });
});
