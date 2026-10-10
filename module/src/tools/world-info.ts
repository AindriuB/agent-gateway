/* eslint-disable @typescript-eslint/no-explicit-any */
import { foundryGeneration } from '../compat/index.js';
import type { OpHandler } from '../ops/types.js';
import { inlineText } from '../serialise/index.js';
import { folderAllowed } from '../policy/folders.js';
import { presentedName } from './visibility.js';

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
    // Players see the navigation name, as in Foundry's scene navigation.
    // A scene outside the agent's folder allowlist is omitted, as if there were no active scene.
    activeScene:
      scene && folderAllowed(scene, user?.isGM === true) ? presentedName(scene, user) : '',
    combatActive,
  };
  const text =
    `World "${inlineText(info.worldTitle)}" (${inlineText(info.worldId)}), ` +
    `system ${inlineText(info.systemId)} ${inlineText(info.systemVersion)}, ` +
    `Foundry v${info.foundryGeneration}. You act as ${inlineText(info.userName)} (${info.userRole}). ` +
    `Active scene: ${inlineText(info.activeScene) || 'none'}. ` +
    `Combat ${combatActive ? 'is' : 'is not'} active.`;
  return { text, structured: info };
};
