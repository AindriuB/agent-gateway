/* eslint-disable @typescript-eslint/no-explicit-any */
declare const game: any;
declare const CONST: any;

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

/** Per-feature register functions. Later tasks append here (insertion-only). */
export const settingRegistrars: Array<() => void> = [registerFoundation];

export function registerSettings(): void {
  for (const register of settingRegistrars) register();
}
