/* eslint-disable @typescript-eslint/no-explicit-any */
import { foundryGeneration } from '../compat/index.js';
import type { OpHandler } from '../ops/types.js';

declare const game: any;
declare const CONST: any;

function roleName(role: unknown): string {
  const roles: Record<string, unknown> = CONST?.USER_ROLES ?? {};
  return Object.keys(roles).find((k) => roles[k] === role) ?? String(role);
}

export const worldInfoHandler: OpHandler = (ctx) => {
  const user = game.users.get(ctx.user.id);
  const world = game.world ?? {};
  const system = game.system ?? {};
  const scene = game.scenes?.active;
  const combatActive = Boolean(game.combats?.active ?? game.combat);
  const info = {
    worldId: String(world.id ?? ''),
    worldTitle: String(world.title ?? ''),
    systemId: String(system.id ?? ''),
    systemVersion: String(system.version ?? ''),
    foundryGeneration: foundryGeneration(),
    userName: String(user?.name ?? ''),
    userRole: roleName(user?.role),
    activeScene: String(scene?.name ?? ''),
    combatActive,
  };
  const text =
    `World "${info.worldTitle}" (${info.worldId}), system ${info.systemId} ${info.systemVersion}, ` +
    `Foundry v${info.foundryGeneration}. You act as ${info.userName} (${info.userRole}). ` +
    `Active scene: ${info.activeScene || 'none'}. Combat ${combatActive ? 'is' : 'is not'} active.`;
  return { text, structured: info };
};
