import { combatEndTurn } from '@agent-gateway/protocol';
import { advanceCombatCompat } from '../compat/index.js';
import { defineWriteHandler, forbid, owns, trustedUser } from './_write.js';
import { currentCombat, combatantVisible } from './combat-status.js';
export const combatEndTurnHandler = defineWriteHandler({
  targets: () => [],
  async run(ctx) {
    const expected = combatEndTurn.input.parse(ctx.args);
    const combat = currentCombat(ctx);
    const current = combat?.combatant;
    const round = combat?.round;
    const turn = combat?.turn;
    const check = () => {
      const user = trustedUser(ctx);
      if (
        !combat ||
        currentCombat(ctx) !== combat ||
        combat.uuid !== expected.combatUuid ||
        current?.uuid !== expected.currentCombatantUuid ||
        combat.round !== expected.round ||
        combat.turn !== expected.turn ||
        combat.round !== round ||
        combat.turn !== turn ||
        combat.combatant !== current ||
        !current ||
        current.parent !== combat ||
        combat.combatants?.get(current.id) !== current ||
        !owns(current, user) ||
        !combatantVisible(current, user) ||
        combat.round < 1
      )
        forbid('Only the owner of the unchanged current combatant may end this turn');
    };
    check();
    await ctx.snapshot(combat.uuid);
    check();
    await advanceCombatCompat(combat, ctx.callOptions, check);
    return {
      text: 'Combat turn advanced',
      structured: {
        combatUuid: combat.uuid,
        round: combat.round,
        ...(combat.turn !== null ? { turn: combat.turn } : {}),
      },
    };
  },
});
