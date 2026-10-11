/* eslint-disable @typescript-eslint/no-explicit-any */
import { combatStatus } from '@agent-gateway/protocol';
import type { OpContext, OpHandler } from '../ops/types.js';
import { forbid, trustedUser } from './_write.js';
declare const game: any;
export function currentCombat(ctx: OpContext): any {
  trustedUser(ctx);
  const combat = game.combat;
  if (!combat) return undefined;
  if (
    combat.documentName !== 'Combat' ||
    combat.pack ||
    game.combats?.get(combat.id) !== combat ||
    combat.uuid !== `Combat.${combat.id}`
  )
    forbid('A canonical current world combat is required');
  if (
    !Array.isArray(combat.turns) ||
    combat.turns.length > 1000 ||
    !Number.isSafeInteger(combat.round) ||
    combat.round < 0 ||
    combat.round > 1000000 ||
    (combat.turn !== null &&
      (!Number.isSafeInteger(combat.turn) || combat.turn < 0 || combat.turn >= combat.turns.length))
  )
    forbid('Unsupported combat state');
  return combat;
}
export function combatantVisible(combatant: any, user: any): boolean {
  return (
    user.isGM === true ||
    (combatant.hidden !== true && combatant.token?.hidden !== true && combatant.visible === true)
  );
}
export const combatStatusHandler: OpHandler = (ctx) => {
  combatStatus.input.parse(ctx.args);
  const combat = currentCombat(ctx);
  if (!combat) return { text: 'No current combat', structured: { active: false, combatants: [] } };
  const user = trustedUser(ctx);
  const combatants: Array<{ uuid: string; name: string; initiative?: number; defeated: boolean }> =
    [];
  for (const c of combat.turns) {
    if (
      c?.parent !== combat ||
      combat.combatants?.get(c.id) !== c ||
      c.uuid !== `${combat.uuid}.Combatant.${c.id}`
    )
      forbid('Noncanonical combatant');
    if (!combatantVisible(c, user)) continue;
    const row = {
      uuid: c.uuid,
      name: String(c.name ?? '').slice(0, 1000),
      defeated: c.isDefeated === true,
      ...(Number.isFinite(c.initiative) ? { initiative: c.initiative } : {}),
    };
    combatants.push(row);
  }
  const current = combat.combatant;
  return {
    text: 'Current combat status',
    structured: {
      active: true,
      combatUuid: combat.uuid,
      round: combat.round,
      ...(combat.turn !== null ? { turn: combat.turn } : {}),
      ...(current && combatants.some((c) => c.uuid === current.uuid)
        ? { currentCombatantUuid: current.uuid }
        : {}),
      combatants,
    },
  };
};
