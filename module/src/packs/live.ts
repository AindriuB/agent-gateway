import { toolRegistry } from '../ops/registry.js';
import { createPackApi, type PackApi } from './api.js';

declare const game: {
  modules: Map<string, { active?: boolean; api?: PackApi }>;
  i18n?: { localize(key: string): string };
};
declare const Hooks: { callAll(hook: string, api: PackApi): void };
const lifecycle = createPackApi(toolRegistry, {
  active: (id) => game.modules.get(id)?.active === true,
  translate: (key) =>
    game.i18n?.localize(key) ??
    'Register tool packs in the agentGateway.registerPacks hook before ready.',
});
export function installPackApi(): void {
  const module = game.modules.get('agent-gateway');
  if (module) module.api = lifecycle.api;
}
export function registerPacks(): void {
  Hooks.callAll('agentGateway.registerPacks', lifecycle.api);
}
export function sealPacks(): void {
  lifecycle.seal();
}
