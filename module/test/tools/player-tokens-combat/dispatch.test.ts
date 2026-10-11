/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tokenMove, targetSet, combatStatus, combatEndTurn } from '@agent-gateway/protocol';
import { createDispatcher } from '../../../src/ops/dispatch.js';
import { createAuditStage } from '../../../src/audit/stage.js';
import { createPolicyStage } from '../../../src/policy/stage.js';
import { createApprovalStage } from '../../../src/approvals/stage.js';
import { HANDLERS } from '../../../src/tools/index.js';
import type { AuditRecord } from '../../../src/audit/types.js';
import { Hub, settle } from '../../stubs/approvals.js';
import { setup, g, player, other, gm } from './fixtures.js';
let f: ReturnType<typeof setup>;
beforeEach(() => {
  f = setup();
});
afterEach(() => f.restore());
const defs = [tokenMove, targetSet, combatStatus, combatEndTurn];
function integrated(who = player) {
  g.game.user = who;
  const records: AuditRecord[] = [];
  const hub = new Hub();
  hub.tools = defs;
  hub.addUser('p1', false);
  hub.addUser('gm', true);
  const client = hub.client(who.id);
  let id = 0;
  const dispatch = createDispatcher({
    tools: defs,
    handlers: HANDLERS,
    stages: [
      createPolicyStage({ tools: defs }),
      createApprovalStage(() => client.manager, defs),
      createAuditStage({
        isGM: () => who.isGM,
        requestIntent: async () => true,
        categoryOf: (tool) => defs.find((d) => d.name === tool)?.category,
        fromUuid: async (uuid) => f.docs.get(uuid),
        submit: async (record) => {
          records.push(record);
        },
        newId: () => `entry-${++id}`,
        watchChanges: () => () => {},
      }),
    ],
  });
  const call = (tool: string, args: unknown = {}) =>
    dispatch(
      {
        tool,
        args:
          tool === 'combat_end_turn' && Object.keys(args as object).length === 0
            ? {
                combatUuid: f.combat.uuid,
                currentCombatantUuid: f.combat.combatant?.uuid,
                round: f.combat.round,
                turn: f.combat.turn,
              }
            : args,
        agent: { id: 'agent', ownerUserId: who.id, headless: false },
        sessionId: 's',
      },
      who,
    );
  async function approve(tool: string, args: unknown = {}) {
    const pending = call(tool, args);
    await settle();
    const [request] = client.manager.listPending();
    expect(request).toMatchObject({ tool, approver: 'owner' });
    client.manager.resolveApproval(request!.id, { decision: 'approve' });
    return pending;
  }
  return { call, approve, records, client };
}
describe('real default approval and audit dispatch', () => {
  it.each([player, gm])(
    'records transient target changes without fabricated undo for $id',
    async (who) => {
      const t = f.token();
      (other as any).targets = new Set([t.object]);
      const r = integrated(who);
      const pending = r.call('target_set', { tokenUuids: [t.uuid], mode: 'replace' });
      await settle();
      expect(g.canvas.tokens.setTargets).not.toHaveBeenCalled();
      const [request] = r.client.manager.listPending();
      expect(request).toBeDefined();
      r.client.manager.resolveApproval(request!.id, { decision: 'approve' });
      expect(await pending).not.toHaveProperty('error');
      expect(r.records).toHaveLength(1);
      expect(r.records[0]).toMatchObject({ tool: 'target_set', status: 'ok', targets: [] });
      expect([...(other as any).targets]).toEqual([t.object]);
    },
  );
  it.each([player, gm])(
    'retains combat write audit as view-only unsupported target for $id',
    async (who) => {
      const r = integrated(who);
      expect(await r.approve('combat_end_turn')).not.toHaveProperty('error');
      expect(r.records).toHaveLength(1);
      expect(r.records[0]).toMatchObject({ tool: 'combat_end_turn', status: 'ok' });
      expect(r.records[0]!.targets).toHaveLength(1);
      expect(r.records[0]!.targets[0]).toMatchObject({ uuid: 'Combat.c', undoable: false });
      expect(f.combat.update.mock.calls[0][1].agentGateway.callId).toBe(r.records[0]!.entryId);
    },
  );
  it('dispatches signed shifted-scene coordinates but refuses outside footprint bounds', async () => {
    const t = f.token();
    f.scene.dimensions.sceneRect = { x: -250, y: -150, width: 1000, height: 800 };
    const r = integrated();
    expect(await r.approve('token_move', { tokenUuid: t.uuid, x: -2.5, y: -1.5 })).toMatchObject({
      structured: { completed: true, x: -2.5, y: -1.5 },
    });
    t.move.mockClear();
    expect(await r.approve('token_move', { tokenUuid: t.uuid, x: -2.51, y: -1.5 })).toMatchObject({
      error: { code: 'INVALID_ARGS' },
    });
    expect(t.move).not.toHaveBeenCalled();
    expect(r.records.map((record) => record.status)).toEqual(['ok', 'error']);
  });
  it('does not expose a hidden owned current combatant through real read dispatch', async () => {
    const c = f.combat.combatant;
    c.hidden = true;
    c.name = 'SECRET';
    c.initiative = 9876;
    const r = integrated();
    const result = await r.call('combat_status');
    expect(result).not.toHaveProperty('error');
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(JSON.stringify(result)).not.toContain('9876');
    expect((result as any).structured.currentCombatantUuid).toBeUndefined();
    expect(r.records).toHaveLength(0);
  });
  it('rechecks ownership changed during real approval before mutation', async () => {
    const t = f.token();
    const r = integrated();
    const result = r.call('token_move', { tokenUuid: t.uuid, x: 1, y: 1 });
    await settle();
    t.owners.clear();
    const [request] = r.client.manager.listPending();
    r.client.manager.resolveApproval(request!.id, { decision: 'approve' });
    expect(await result).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(t.move).not.toHaveBeenCalled();
  });
});

describe('approval-bound expected combat state', () => {
  it.each(['ownedNextTurn', 'roundChanged', 'combatChanged'])(
    'refuses %s changed during real owner approval',
    async (change) => {
      const r = integrated();
      f.combat.turns[1].owners.add(player.id);
      const result = r.call('combat_end_turn');
      await settle();
      const [request] = r.client.manager.listPending();
      expect(request!.args).toMatchObject({
        combatUuid: 'Combat.c',
        currentCombatantUuid: 'Combat.c.Combatant.a',
        round: 1,
        turn: 0,
      });
      if (change === 'ownedNextTurn') f.combat.turn = 1;
      if (change === 'roundChanged') f.combat.round = 2;
      if (change === 'combatChanged') {
        const replacement = { ...f.combat, id: 'different', uuid: 'Combat.different' };
        g.game.combats.set(replacement.id, replacement);
        g.game.combat = replacement;
      }
      r.client.manager.resolveApproval(request!.id, { decision: 'approve' });
      expect(await result).toMatchObject({ error: { code: 'FORBIDDEN' } });
      expect(f.combat.update).not.toHaveBeenCalled();
    },
  );
  it('requires the strict expected tuple before any approval request', async () => {
    const r = integrated();
    expect(await r.call('combat_end_turn', { round: 1 })).toMatchObject({
      error: { code: 'INVALID_ARGS' },
    });
    expect(r.client.manager.listPending()).toHaveLength(0);
  });
});
