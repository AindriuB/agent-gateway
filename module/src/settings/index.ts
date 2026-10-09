/* eslint-disable @typescript-eslint/no-explicit-any */
import { registerPairingMenu } from '../apps/pairing/index.js';
declare const game: any;

const NS = 'agent-gateway';

function registerFoundation(): void {
  game.settings.register(NS, 'gatewayUrl', {
    name: 'AGENT_GATEWAY.Settings.gatewayUrl.name',
    hint: 'AGENT_GATEWAY.Settings.gatewayUrl.hint',
    scope: 'client',
    config: true,
    type: String,
    default: 'ws://localhost:7420',
  });
  game.settings.register(NS, 'pairingToken', {
    name: 'AGENT_GATEWAY.Settings.pairingToken.name',
    hint: 'AGENT_GATEWAY.Settings.pairingToken.hint',
    scope: 'client',
    config: false,
    type: Object,
    default: null,
  });
  game.settings.register(NS, 'includeOtherModuleData', {
    name: 'AGENT_GATEWAY.Settings.includeOtherModuleData.name',
    hint: 'AGENT_GATEWAY.Settings.includeOtherModuleData.hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    restricted: true,
  });
}

/** Per-feature register functions. Later tasks append here (insertion-only). */
export const settingRegistrars: Array<() => void> = [
  // One registrar per line; append new ones below.
  registerFoundation,
  registerPairingMenu,
];

export function registerSettings(): void {
  for (const register of settingRegistrars) {
    try {
      register();
    } catch (e) {
      // One failing registrar must not abort the others.
      console.error('agent-gateway | settings registrar failed', e);
    }
  }
}
