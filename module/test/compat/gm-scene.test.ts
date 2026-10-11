/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  manageCombatProgressCompat,
  checkNativeInitiativeFormula,
  prepareCoreInitiativeCompat,
  viewSceneCompat,
} from '../../src/compat/index.js';
afterEach(() => vi.unstubAllGlobals());
function setup(generation: number, round = 1, turn: number | null = 0, defeated = [false, false]) {
  vi.stubGlobal('game', { release: { generation }, system: { id: 'test' } });
  vi.stubGlobal('Hooks', { callAll: vi.fn() });
  vi.stubGlobal('ui', { notifications: { warn: vi.fn() } });
  vi.stubGlobal('foundry', { documents: { ActiveEffect: { registry: { refresh: vi.fn() } } } });
  const combat: any = {
    round,
    turn,
    turns: defeated.map((isDefeated) => ({ isDefeated })),
    settings: { skipDefeated: false },
    getTimeDelta: vi.fn(
      (r: number, t: number, rr: number, tt: number) => (rr - r) * 6 + (tt ?? 0) - (t ?? 0),
    ),
    _playCombatSound: vi.fn(),
  };
  combat.update = vi.fn(async (data: any) => {
    Object.assign(combat, data);
    return combat;
  });
  return combat;
}
const opts = { agentGateway: { callId: 'audit' } };
describe.each([13, 14])('audited native progression %i', (gen) => {
  it.each(['start', 'next_turn', 'previous_turn', 'next_round'] as const)(
    'forwards correlation for %s',
    async (action) => {
      const c = setup(gen, 2, 1);
      const guard = vi.fn();
      await manageCombatProgressCompat(c, action, opts, guard);
      expect(c.update).toHaveBeenCalledOnce();
      expect(c.update.mock.calls[0][1].agentGateway.callId).toBe('audit');
      expect(guard).toHaveBeenCalledTimes(2);
    },
  );
  it('wraps all-defeated turns using native warning and round', async () => {
    const c = setup(gen, 1, 1, [true, true]);
    c.settings.skipDefeated = true;
    await manageCombatProgressCompat(c, 'next_turn', opts, () => {});
    expect(c).toMatchObject({ round: 2, turn: 0 });
    expect((globalThis as any).ui.notifications.warn).toHaveBeenCalledOnce();
  });
  it('handles empty native next round with null turn', async () => {
    const c = setup(gen, 0, null, []);
    await manageCombatProgressCompat(c, 'next_round', opts, () => {});
    expect(c).toMatchObject({ round: 1, turn: null });
  });
  it('preserves original callId despite hook mutation', async () => {
    const c = setup(gen);
    (globalThis as any).Hooks.callAll = (_h: any, _c: any, _d: any, o: any) => {
      o.agentGateway.callId = 'spoof';
    };
    await manageCombatProgressCompat(c, 'next_turn', opts, () => {});
    expect(c.update.mock.calls[0][1].agentGateway.callId).toBe('audit');
  });
  it('rejects invalid hook values before update', async () => {
    const c = setup(gen);
    (globalThis as any).Hooks.callAll = (_h: any, _c: any, d: any) => {
      d.round = NaN;
    };
    await expect(manageCombatProgressCompat(c, 'next_turn', opts, () => {})).rejects.toThrow();
    expect(c.update).not.toHaveBeenCalled();
  });
  it('rejects hook-time loss of authority', async () => {
    const c = setup(gen);
    let calls = 0;
    await expect(
      manageCombatProgressCompat(c, 'next_turn', opts, () => {
        if (++calls === 2) throw Error('demoted');
      }),
    ).rejects.toThrow('demoted');
    expect(c.update).not.toHaveBeenCalled();
  });
  it('rejects cancelled update', async () => {
    const c = setup(gen);
    c.update = vi.fn(async () => undefined);
    await expect(manageCombatProgressCompat(c, 'next_turn', opts, () => {})).rejects.toThrow(
      'cancelled',
    );
  });
});
it('refuses failed local scene view without activating', async () => {
  vi.stubGlobal('canvas', { ready: false });
  const scene = { view: vi.fn(), activate: vi.fn() };
  await expect(viewSceneCompat(scene)).rejects.toThrow();
  expect(scene.activate).not.toHaveBeenCalled();
});
it('prepares native core initiative without tracker/chat calls', async () => {
  const evaluate = vi.fn();
  const getInitiativeRoll = function () {
    return { evaluate, total: 12, formula: '1d20+2' };
  };
  const formula = vi.fn();
  const getRollData = vi.fn();
  vi.stubGlobal('game', { system: { id: 'test' } });
  vi.stubGlobal('foundry', {
    documents: {
      Combatant: { prototype: { getInitiativeRoll, _getInitiativeFormula: formula } },
      Actor: { prototype: { getRollData } },
    },
  });
  expect(
    (
      await prepareCoreInitiativeCompat({
        getInitiativeRoll,
        _getInitiativeFormula: formula,
        actor: { getRollData },
      })
    ).total,
  ).toBe(12);
  expect(evaluate).toHaveBeenCalledOnce();
});
it('refuses PF2e before invoking native rule-bearing preparation', async () => {
  vi.stubGlobal('game', { system: { id: 'pf2e' } });
  const getInitiativeRoll = vi.fn();
  await expect(prepareCoreInitiativeCompat({ getInitiativeRoll })).rejects.toThrow('unsupported');
  expect(getInitiativeRoll).not.toHaveBeenCalled();
});

it.each(['1000000d6', '1d6r100000', '1d6!', '1d6+Infinity', '1d6**1000'])(
  'rejects unsafe native initiative formula %s before evaluation',
  (formula) => {
    expect(() => checkNativeInitiativeFormula(formula)).toThrow();
  },
);
it('refuses loading local view even if target canvas is already ready', async () => {
  const scene = { view: async () => undefined };
  vi.stubGlobal('canvas', { ready: true, loading: true, scene });
  await expect(viewSceneCompat(scene)).rejects.toThrow();
});
it('checks authority after start update before effect refresh', async () => {
  const c = setup(14);
  const after = () => {
    throw new Error('demoted');
  };
  await expect(manageCombatProgressCompat(c, 'start', opts, () => {}, after)).rejects.toThrow(
    'demoted',
  );
  expect(
    (globalThis as any).foundry.documents.ActiveEffect.registry.refresh,
  ).not.toHaveBeenCalled();
  expect(c.round).toBe(1);
});
