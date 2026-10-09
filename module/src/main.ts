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
  (globalThis as { addEventListener?: (t: string, f: () => void) => void }).addEventListener?.(
    'beforeunload',
    stopLink,
  );
});
