/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceCombatCompat } from '../../src/compat/index.js';
import { setup, g } from '../tools/player-tokens-combat/fixtures.js';
let f: ReturnType<typeof setup>;
const options = { agentGateway: { callId: 'original' } };
afterEach(() => f?.restore());
describe.each([13, 14] as const)('audited native combat advancement v%i', (generation) => {
  beforeEach(() => {
    f = setup(generation);
  });
  it.each([false, true])(
    'preserves next turn/time/hook/audit with skipDefeated=%s',
    async (skip) => {
      f.combat.settings.skipDefeated = skip;
      const check = vi.fn();
      await advanceCombatCompat(f.combat, options, check);
      expect(f.combat.getTimeDelta).toHaveBeenCalledWith(1, 0, 1, 1);
      expect(g.Hooks.callAll).toHaveBeenCalledWith(
        'combatTurn',
        f.combat,
        { round: 1, turn: 1 },
        expect.objectContaining({ worldTime: { delta: 6 } }),
      );
      expect(f.combat.update).toHaveBeenCalledWith(
        { round: 1, turn: 1 },
        expect.objectContaining(options),
      );
      expect(check).toHaveBeenCalledOnce();
    },
  );
  it('skips defeated combatants', async () => {
    f.combat.settings.skipDefeated = true;
    f.combat.turns[1].isDefeated = true;
    f.combatant('third');
    await advanceCombatCompat(f.combat, options, () => {});
    expect(f.combat.turn).toBe(2);
  });
  it('wraps to next round and first undefeated combatant', async () => {
    f.combat.turn = 1;
    f.combat.settings.skipDefeated = true;
    f.combat.turns[0].isDefeated = true;
    await advanceCombatCompat(f.combat, options, () => {});
    expect(f.combat.round).toBe(2);
    expect(f.combat.turn).toBe(1);
    expect(g.Hooks.callAll.mock.calls[0][0]).toBe('combatRound');
    expect(f.combat.getTimeDelta).toHaveBeenCalledWith(1, 1, 2, 1);
  });
  it('retains native all-defeated warning and turn zero', async () => {
    f.combat.settings.skipDefeated = true;
    for (const c of f.combat.turns) c.isDefeated = true;
    await advanceCombatCompat(f.combat, options, () => {});
    expect(f.combat.turn).toBe(0);
    expect(f.combat.round).toBe(2);
    expect(g.ui.notifications.warn).toHaveBeenCalledWith('COMBAT.NoneRemaining', {
      localize: true,
    });
  });
  it.each(['nested', 'replacement'])(
    'preserves original audit callId after %s hook mutation',
    async (kind) => {
      const opts = { agentGateway: { callId: 'original' } };
      g.Hooks.callAll = (_h: any, _c: any, _d: any, o: any) => {
        if (kind === 'nested') o.agentGateway.callId = 'forged';
        else o.agentGateway = { callId: 'forged' };
      };
      await advanceCombatCompat(f.combat, opts, () => {});
      expect(f.combat.update.mock.calls[0][1].agentGateway).toEqual({ callId: 'original' });
      expect(opts.agentGateway.callId).toBe('original');
    },
  );
  it.each(['round', 'turn', 'time'])('rejects invalid final hook %s', async (kind) => {
    g.Hooks.callAll = (_h: any, _c: any, d: any, o: any) => {
      if (kind === 'round') d.round = Infinity;
      if (kind === 'turn') d.turn = NaN;
      if (kind === 'time') o.worldTime.delta = Infinity;
    };
    await expect(advanceCombatCompat(f.combat, options, () => {})).rejects.toThrow();
    expect(f.combat.update).not.toHaveBeenCalled();
  });
  it('executes final guard after hooks and before update', async () => {
    const order: string[] = [];
    g.Hooks.callAll = () => order.push('hook');
    f.combat.update = async (data: any) => {
      order.push('update');
      Object.assign(f.combat, data);
      return f.combat;
    };
    await advanceCombatCompat(f.combat, options, () => {
      order.push('guard');
    });
    expect(order).toEqual(['hook', 'guard', 'update']);
  });
  it.each(['cancelled', 'notPersisted', 'wrongDocument'])(
    'does not claim success when update is %s',
    async (kind) => {
      f.combat.update = vi.fn(async () =>
        kind === 'cancelled' ? undefined : kind === 'wrongDocument' ? { ...f.combat } : f.combat,
      );
      await expect(advanceCombatCompat(f.combat, options, () => {})).rejects.toThrow(
        'cancelled or did not persist',
      );
      expect(f.combat.update).toHaveBeenCalledOnce();
    },
  );
  it.each(['oversized', 'badTime', 'badTurn', 'badRound'])(
    'refuses invalid %s native state before update',
    async (kind) => {
      if (kind === 'oversized') f.combat.turns = Array(1001).fill({});
      if (kind === 'badTime') f.combat.getTimeDelta = () => Infinity;
      if (kind === 'badTurn') f.combat.turn = 100;
      if (kind === 'badRound') f.combat.round = NaN;
      await expect(advanceCombatCompat(f.combat, options, () => {})).rejects.toThrow();
      expect(f.combat.update).not.toHaveBeenCalled();
    },
  );
});
