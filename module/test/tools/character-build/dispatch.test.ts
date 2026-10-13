/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { characterBuild } from '@agent-gateway/protocol';
import { installFoundry } from '../../stubs/foundry.js';
import { createDispatcher } from '../../../src/ops/dispatch.js';
import { actionCategory, effectiveCategory } from '../../../src/ops/context.js';
import { HANDLERS } from '../../../src/tools/index.js';
import { createAuditStage } from '../../../src/audit/stage.js';
import type { Stage } from '../../../src/ops/stages.js';
import { events, pf2eActor, resetEvents } from './fixtures.js';

const g = globalThis as any;
let stub: ReturnType<typeof installFoundry>, actor: any, user: any, records: any[], seen: string[];
class ActorClass {}
function call(args: any = { actorUuid: 'Actor.a' }) {
  return {
    tool: 'character_build',
    args,
    agent: { id: 'agent', ownerUserId: user.id, headless: false },
    sessionId: 'session',
  };
}
function dispatcher() {
  const stages: Stage[] = [
    ...['policy', 'rate', 'approval'].map((name, i) => ({
      name,
      order: 20 + i * 5,
      async run(ctx: any, next: any) {
        seen.push(`${name}:${effectiveCategory(ctx, characterBuild.category)}`);
        return next();
      },
    })),
    createAuditStage({
      categoryOf: () => characterBuild.category,
      isGM: () => true,
      fromUuid: async (uuid: string) => {
        events.push(`snapshot-read:${uuid}`);
        return actor;
      },
      submit: async (r) => {
        records.push(r);
      },
      newId: () => 'entry-build0001',
      now: () => 1,
      watchChanges: () => () => {},
    }),
  ];
  return createDispatcher({
    tools: [characterBuild],
    handlers: { character_build: HANDLERS.character_build! },
    stages,
  });
}
beforeEach(() => {
  stub = installFoundry(14);
  resetEvents();
  user = { id: 'p', isGM: false };
  g.game.user = user;
  g.game.users = { get: (id: string) => (id === user.id ? user : undefined) };
  g.game.system = { id: 'pf2e' };
  actor = pf2eActor();
  Object.setPrototypeOf(actor, ActorClass.prototype);
  g.CONFIG = {
    Actor: { documentClass: ActorClass },
    PF2E: { skills: { acrobatics: {}, athletics: {} } },
  };
  g.game.actors = new Map([['a', actor]]);
  g.fromUuid = vi.fn(async () => actor);
  records = [];
  seen = [];
});
afterEach(() => {
  stub.uninstall();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const change = { kind: 'skill_rank', skill: 'athletics', rank: 2 };

describe('character_build through the dispatcher', () => {
  it('classifies changes as write in actionCategory and not without them', () => {
    expect(actionCategory('character_build', { actorUuid: 'x', changes: [] }, 'read')).toBe(
      'write',
    );
    expect(actionCategory('character_build', { actorUuid: 'x' }, 'read')).toBe('read');
    expect(actionCategory('character_build', { changes: [] }, 'read', false)).toBe('read');
  });
  it('reads as a read with no snapshot and no audit record', async () => {
    const result = await dispatcher()(call(), user);
    expect(result).toMatchObject({
      structured: { actorUuid: 'Actor.a', systemId: 'pf2e', supported: true },
    });
    expect(seen).toEqual(['policy:read', 'rate:read', 'approval:read']);
    expect(records).toEqual([]);
    expect(actor.update).not.toHaveBeenCalled();
  });
  it('policy sees write for a change, and the approved write is snapshotted then updated', async () => {
    const result = await dispatcher()(call({ actorUuid: 'Actor.a', changes: [change] }), user);
    expect(result).toMatchObject({ structured: { supported: true } });
    expect(seen).toEqual(['policy:write', 'rate:write', 'approval:write']);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe('write');
    expect(actor.update).toHaveBeenCalledWith(
      { 'system.skills.athletics.rank': 2 },
      expect.objectContaining({ agentGateway: { callId: 'entry-build0001' } }),
    );
    expect(events.indexOf('snapshot-read:Actor.a')).toBeLessThan(events.indexOf('update:Actor.a'));
  });
  it('answers unsupported on a system without a hook: read false, change INVALID_ARGS', async () => {
    g.game.system = { id: 'starfinder' };
    expect(await dispatcher()(call(), user)).toMatchObject({
      structured: { supported: false, boosts: [], skills: [], featSlots: [] },
    });
    expect(
      await dispatcher()(call({ actorUuid: 'Actor.a', changes: [change] }), user),
    ).toMatchObject({
      error: { code: 'INVALID_ARGS', message: 'Operation not supported for starfinder' },
    });
    expect(actor.update).not.toHaveBeenCalled();
  });
  it('maps pf2e validation failures to INVALID_ARGS without a write', async () => {
    const bad = { kind: 'skill_rank', skill: 'nonsense', rank: 1 };
    expect(await dispatcher()(call({ actorUuid: 'Actor.a', changes: [bad] }), user)).toMatchObject({
      error: { code: 'INVALID_ARGS' },
    });
    expect(actor.update).not.toHaveBeenCalled();
  });
  it('refuses a player who does not own the Actor, for reads and changes', async () => {
    actor.owned = false;
    expect(await dispatcher()(call(), user)).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(
      await dispatcher()(call({ actorUuid: 'Actor.a', changes: [change] }), user),
    ).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(actor.update).not.toHaveBeenCalled();
  });
});
