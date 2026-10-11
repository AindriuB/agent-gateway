/* eslint-disable @typescript-eslint/no-explicit-any */
import { registerPolicyMenu } from '../apps/policy/index.js';
import { registerPairingMenu } from '../apps/pairing/index.js';
import { registerPolicySettings } from '../policy/store.js';
import { registerRateLimitSettings } from '../ratelimit/store.js';
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
    type: String,
    default: '',
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

function registerPairingCredential(): void {
  // The {url, token} pair issued by a gateway; the legacy string `pairingToken` is never sent.
  game.settings.register(NS, 'pairingCredential', {
    name: 'AGENT_GATEWAY.Settings.pairingCredential.name',
    hint: 'AGENT_GATEWAY.Settings.pairingCredential.hint',
    scope: 'client',
    config: false,
    type: String, // JSON `{url, token}`; an Object-typed client setting does not survive a reload
    default: '',
  });
}

/** Per-feature register functions. Later tasks append here (insertion-only). */
export const settingRegistrars: Array<() => void> = [registerFoundation];

settingRegistrars.push(registerPairingCredential, registerPairingMenu);
settingRegistrars.push(registerPolicySettings);
settingRegistrars.push(registerRateLimitSettings);
settingRegistrars.push(registerPolicyMenu);

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
