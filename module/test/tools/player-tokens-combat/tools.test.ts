/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  combatEndTurn,
  combatStatus,
  targetSet,
  tokenMove,
  TOOLS,
  checkToolDefinition,
  toJsonSchema,
} from '@agent-gateway/protocol';
import { tokenMoveHandler } from '../../../src/tools/token-move.js';
import { targetSetHandler } from '../../../src/tools/target-set.js';
import { combatStatusHandler } from '../../../src/tools/combat-status.js';
import { combatEndTurnHandler } from '../../../src/tools/combat-end-turn.js';
import { HANDLERS } from '../../../src/tools/index.js';
import { setup, g, player, other, gm } from './fixtures.js';
let f: ReturnType<typeof setup>;
beforeEach(() => {
  f = setup();
});
afterEach(() => f.restore());
const forbidden = { error: { code: 'FORBIDDEN' } };
describe('bounded core schemas and canonical token movement', () => {
  it.each([tokenMove, targetSet, combatStatus, combatEndTurn])(
    'registers $name with checked core metadata',
    (d) => {
      expect(TOOLS).toContain(d);
      expect(HANDLERS[d.name]).toBeTypeOf('function');
      expect(
        checkToolDefinition(
          {
            ...toJsonSchema(d),
            name: d.name,
            description: d.description,
            minRole: d.minRole,
            handledBy: d.handledBy,
            category: d.category,
          },
          'core',
        ),
      ).toEqual([]);
    },
  );
  it.each([
    { x: Infinity, y: 1 },
    { x: -1000001, y: 1 },
    { path: [] },
    { path: Array.from({ length: 21 }, () => ({ x: 1, y: 1 })) },
    { x: 1, y: 1, bypass: true },
  ])('rejects schema bounds %j', (args) =>
    expect(tokenMove.input.safeParse({ tokenUuid: 'Scene.s.Token.t', ...args }).success).toBe(
      false,
    ),
  );
  it.each([{ x: 1 }, {}, { x: 1, y: 1, path: [{ x: 2, y: 2 }] }])(
    'rejects mixed/incomplete movement %j',
    async (args) => {
      const t = f.token();
      expect(
        await tokenMoveHandler(f.ctx('token_move', { tokenUuid: t.uuid, ...args })),
      ).toMatchObject({ error: { code: 'INVALID_ARGS' } });
      expect(t.move).not.toHaveBeenCalled();
    },
  );
  it.each([13, 14] as const)(
    'moves fractional grid waypoints and forwards audited options on v%i',
    async (generation) => {
      f.restore();
      f = setup(generation);
      const t = f.token();
      const ctx = f.ctx('token_move', {
        tokenUuid: t.uuid,
        path: [
          { x: 0.5, y: 1 },
          { x: 2, y: 3 },
        ],
      });
      expect(await tokenMoveHandler(ctx)).toMatchObject({
        structured: { completed: true, x: 2, y: 3 },
      });
      expect(t.move).toHaveBeenCalledWith(
        [
          { x: 50, y: 100 },
          { x: 200, y: 300 },
        ],
        ctx.callOptions,
      );
      expect(ctx.snapshot).toHaveBeenCalledWith(t.uuid);
    },
  );

  it('uses the actual padded and shifted scene rectangle', async () => {
    const t = f.token();
    f.scene.dimensions.sceneRect = { x: 200, y: 100, width: 1000, height: 800 };
    expect(
      await tokenMoveHandler(f.ctx('token_move', { tokenUuid: t.uuid, x: 0, y: 1 })),
    ).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect(t.move).not.toHaveBeenCalled();
    expect(
      await tokenMoveHandler(f.ctx('token_move', { tokenUuid: t.uuid, x: 11, y: 8 })),
    ).toMatchObject({ structured: { completed: true, x: 11, y: 8 } });
  });
  it('accepts signed grid coordinates only within the shifted native scene rectangle', async () => {
    const t = f.token();
    f.scene.dimensions.sceneRect = { x: -250, y: -150, width: 1000, height: 800 };
    expect(
      await tokenMoveHandler(
        f.ctx('token_move', {
          tokenUuid: t.uuid,
          path: [
            { x: -2.5, y: -1.5 },
            { x: -1, y: -0.5 },
          ],
        }),
      ),
    ).toMatchObject({ structured: { completed: true, x: -1, y: -0.5 } });
    t.move.mockClear();
    expect(
      await tokenMoveHandler(f.ctx('token_move', { tokenUuid: t.uuid, x: -2.51, y: -1.5 })),
    ).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect(t.move).not.toHaveBeenCalled();
  });
  it('reports actual partial v13 coordinates with completed false', async () => {
    f.restore();
    f = setup(13);
    const t = f.token();
    t.move.mockImplementation(async () => {
      t.x = 150;
      t.y = 100;
      t.movement.state = 'stopped';
      return true;
    });
    expect(
      await tokenMoveHandler(
        f.ctx('token_move', {
          tokenUuid: t.uuid,
          path: [
            { x: 1, y: 1 },
            { x: 3, y: 1 },
          ],
        }),
      ),
    ).toMatchObject({ structured: { completed: false, x: 1.5, y: 1 } });
  });
  it('uses native non-square hex footprint instead of width times nominal grid size', async () => {
    const t = f.token();
    t.getSize = () => ({ width: 150, height: 120 });
    expect(
      await tokenMoveHandler(f.ctx('token_move', { tokenUuid: t.uuid, x: 8.6, y: 1 })),
    ).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect(t.move).not.toHaveBeenCalled();
    expect(
      await tokenMoveHandler(f.ctx('token_move', { tokenUuid: t.uuid, x: 8.5, y: 6.8 })),
    ).toMatchObject({ structured: { completed: true } });
  });
  it('reports native blocked movement without claiming completion', async () => {
    const t = f.token();
    t.move.mockResolvedValue(false);
    expect(
      await tokenMoveHandler(f.ctx('token_move', { tokenUuid: t.uuid, x: 1, y: 1 })),
    ).toMatchObject({ structured: { completed: false, x: 0, y: 0 } });
  });
  it.each(['ownership', 'logout', 'replacement', 'scene', 'visibility'])(
    'refuses stale %s after snapshot',
    async (change) => {
      const t = f.token();
      const ctx = f.ctx('token_move', { tokenUuid: t.uuid, x: 1, y: 1 });
      ctx.snapshot = async () => {
        if (change === 'ownership') t.owners.clear();
        if (change === 'logout') g.game.user = undefined;
        if (change === 'replacement') f.scene.tokens.set(t.id, { ...t });
        if (change === 'scene') g.canvas.scene = { ...f.scene };
        if (change === 'visibility') t.object.visible = false;
      };
      expect(await tokenMoveHandler(ctx)).toMatchObject(forbidden);
      expect(t.move).not.toHaveBeenCalled();
    },
  );
  it.each([
    { x: 10, y: 1 },
    { x: 1, y: 8 },
    { x: 9.1, y: 1 },
  ])('bounds entire footprint %j', async (args) => {
    const t = f.token();
    expect(
      await tokenMoveHandler(f.ctx('token_move', { tokenUuid: t.uuid, ...args })),
    ).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect(t.move).not.toHaveBeenCalled();
  });
  it('fails closed without write audit capabilities', async () => {
    const t = f.token();
    const c = f.ctx('token_move', { tokenUuid: t.uuid, x: 1, y: 1 });
    delete c.snapshot;
    expect(await tokenMoveHandler(c)).toMatchObject({ error: { code: 'INTERNAL' } });
    expect(t.move).not.toHaveBeenCalled();
  });
});
describe('transient native target isolation', () => {
  it.each(['replace', 'add', 'clear'] as const)(
    'changes only caller targets using native %s',
    async (mode) => {
      const a = f.token('a'),
        b = f.token('b');
      (player as any).targets = new Set([a.object]);
      (other as any).targets = new Set([b.object]);
      const c = f.ctx('target_set', { tokenUuids: mode === 'clear' ? [] : [b.uuid], mode });
      expect(await targetSetHandler(c)).not.toHaveProperty('error');
      expect([...(other as any).targets]).toEqual([b.object]);
      expect(c.snapshot).not.toHaveBeenCalled();
      expect(c.intendCreate).not.toHaveBeenCalled();
      expect(g.canvas.tokens.setTargets).toHaveBeenCalledWith(mode === 'clear' ? [] : ['b'], {
        mode: mode === 'add' ? 'acquire' : 'replace',
      });
    },
  );
  it.each(['hidden', 'invisible', 'unrenderable', 'foreign', 'identity'])(
    'validates all targets before mutation: %s',
    async (kind) => {
      const a = f.token('a'),
        b = f.token('b');
      if (kind === 'hidden') b.hidden = true;
      if (kind === 'invisible') b.object.visible = false;
      if (kind === 'unrenderable') b.object.renderable = false;
      if (kind === 'foreign') b.parent = { ...f.scene };
      if (kind === 'identity')
        g.fromUuid = async (uuid: string) => {
          await Promise.resolve();
          g.game.user = other;
          return f.docs.get(uuid);
        };
      expect(
        await targetSetHandler(
          f.ctx('target_set', { tokenUuids: [a.uuid, b.uuid], mode: 'replace' }),
        ),
      ).toMatchObject(forbidden);
      expect(g.canvas.tokens.setTargets).not.toHaveBeenCalled();
    },
  );
  it('rejects more than ten accumulated targets', async () => {
    (player as any).targets = new Set(
      Array.from({ length: 10 }, (_, i) => f.token(String(i)).object),
    );
    const t = f.token('extra');
    expect(
      await targetSetHandler(f.ctx('target_set', { tokenUuids: [t.uuid], mode: 'add' })),
    ).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect(g.canvas.tokens.setTargets).not.toHaveBeenCalled();
  });
  it('clear rejects nonempty input and invalid schemas reject eleven targets', async () => {
    expect(
      targetSet.input.safeParse({ tokenUuids: Array(11).fill('x'), mode: 'replace' }).success,
    ).toBe(false);
    expect(
      await targetSetHandler(f.ctx('target_set', { tokenUuids: ['x'], mode: 'clear' })),
    ).toMatchObject({ error: { code: 'INVALID_ARGS' } });
  });
});
describe('combat privacy and owned turn advancement', () => {
  it('hides owned hidden current identities and initiative for every nonGM', async () => {
    const c = f.combat.combatant;
    c.hidden = true;
    c.name = 'secret';
    c.initiative = 99;
    const result = await combatStatusHandler(f.ctx('combat_status'));
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result).toMatchObject({
      structured: { round: 1, turn: 0, combatants: [{ name: 'b' }] },
    });
    expect((result as any).structured.currentCombatantUuid).toBeUndefined();
  });
  it('GM sees hidden current combatants', async () => {
    g.game.user = gm;
    f.combat.combatant.hidden = true;
    expect(await combatStatusHandler(f.ctx('combat_status', {}, gm))).toMatchObject({
      structured: { currentCombatantUuid: 'Combat.c.Combatant.a' },
    });
  });
  it('returns explicit no-current-combat state', async () => {
    g.game.combat = null;
    expect(await combatStatusHandler(f.ctx('combat_status'))).toMatchObject({
      structured: { active: false, combatants: [] },
    });
  });
  it('bounds enumeration without truncating into false success', () => {
    f.combat.turns = Array(1001).fill(f.combat.combatant);
    expect(() => combatStatusHandler(f.ctx('combat_status'))).toThrow();
  });
  it('snapshots before one audited native update', async () => {
    const c = f.ctx('combat_end_turn');
    expect(await combatEndTurnHandler(c)).toMatchObject({ structured: { round: 1, turn: 1 } });
    expect(c.snapshot).toHaveBeenCalledWith('Combat.c');
    expect(f.combat.update).toHaveBeenCalledWith(
      { round: 1, turn: 1 },
      expect.objectContaining(c.callOptions),
    );
  });
  it.each(['ownership', 'turn', 'identity', 'replacement'])(
    'refuses %s changed while snapshot awaits',
    async (kind) => {
      const c = f.ctx('combat_end_turn');
      c.snapshot = async () => {
        if (kind === 'ownership') f.combat.combatant.owners.clear();
        if (kind === 'turn') f.combat.turn = 1;
        if (kind === 'identity') g.game.user = other;
        if (kind === 'replacement') g.game.combat = { ...f.combat };
      };
      expect(await combatEndTurnHandler(c)).toMatchObject(forbidden);
      expect(f.combat.update).not.toHaveBeenCalled();
    },
  );
  it.each(['ownership', 'turn', 'logout'])(
    'rechecks synchronously after native hook: %s',
    async (kind) => {
      g.Hooks.callAll = vi.fn(() => {
        if (kind === 'ownership') f.combat.combatant.owners.clear();
        if (kind === 'turn') f.combat.turn = 1;
        if (kind === 'logout') g.game.user = undefined;
      });
      expect(await combatEndTurnHandler(f.ctx('combat_end_turn'))).toMatchObject(forbidden);
      expect(f.combat.update).not.toHaveBeenCalled();
    },
  );
  it('denies unowned/hidden current combatants', async () => {
    f.combat.turn = 1;
    expect(await combatEndTurnHandler(f.ctx('combat_end_turn'))).toMatchObject(forbidden);
    f.combat.turn = 0;
    f.combat.combatant.hidden = true;
    expect(await combatEndTurnHandler(f.ctx('combat_end_turn'))).toMatchObject(forbidden);
  });
});
