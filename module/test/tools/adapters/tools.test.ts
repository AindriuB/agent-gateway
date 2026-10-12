/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  actorSummary,
  actionsList,
  actionPerform,
  inventory,
  conditions,
} from '@agent-gateway/protocol';
import { installFoundry } from '../../stubs/foundry.js';
import { createDispatcher } from '../../../src/ops/dispatch.js';
import { effectiveCategory } from '../../../src/ops/context.js';
import { HANDLERS } from '../../../src/tools/index.js';
import { genericAdapter } from '../../../src/adapters/generic/index.js';
import { createAuditStage } from '../../../src/audit/stage.js';
import { actionOptions, boundedAdapterData } from '../../../src/tools/_adapters.js';
import { createPackApi } from '../../../src/packs/api.js';
import { ToolRegistry } from '../../../src/ops/registry-class.js';
import { bindReplay } from '../../../src/ops/types.js';
import { createPolicyStage } from '../../../src/policy/stage.js';
import { createRateLimitStage } from '../../../src/ratelimit/stage.js';
import { createApprovalStage } from '../../../src/approvals/stage.js';
import { loadLimits } from '../../../src/ratelimit/config.js';
import type { Stage } from '../../../src/ops/stages.js';
const selection = vi.hoisted(() => ({ adapter: undefined as any }));
vi.mock('../../../src/adapters/index.js', () => ({ selectAdapter: () => selection.adapter }));
const g = globalThis as any;
const tools = [actorSummary, actionsList, actionPerform, inventory, conditions];
let stub: ReturnType<typeof installFoundry>,
  actor: any,
  user: any,
  records: any[],
  seen: string[],
  afterSnapshot: (() => void) | undefined;
class Actor {
  id = 'a';
  uuid = 'Actor.a';
  documentName = 'Actor';
  name = 'Hero';
  img = 'icons/hero.webp';
  type = 'npc';
  parent: any = null;
  pack: any = null;
  isToken = false;
  token: any = null;
  folder: any = null;
  owned = true;
  testUserPermission = () => this.owned;
  toObject = () => ({ _id: this.id, name: this.name, type: this.type });
}
function call(tool: string, args: any = { actorUuid: 'Actor.a' }) {
  return {
    tool,
    args,
    agent: { id: 'agent', ownerUserId: user.id, headless: false },
    sessionId: 'session',
  };
}
function dispatcher(extra: Stage[] = []) {
  const stages: Stage[] = [
    ...['policy', 'rate', 'approval'].map((name, i) => ({
      name,
      order: 20 + i * 5,
      async run(ctx: any, next: any) {
        seen.push(
          `${name}:${effectiveCategory(ctx, tools.find((t) => t.name === ctx.tool)!.category)}`,
        );
        return next();
      },
    })),
    ...extra,
    createAuditStage({
      categoryOf: (t) => tools.find((x) => x.name === t)?.category,
      isGM: () => true,
      fromUuid: async () => {
        afterSnapshot?.();
        return actor;
      },
      submit: async (r) => {
        records.push(r);
      },
      newId: () => 'entry-adapter01',
      now: () => 1,
      watchChanges: () => () => {},
    }),
  ];
  return createDispatcher({
    tools,
    handlers: Object.fromEntries(tools.map((t) => [t.name, HANDLERS[t.name]!])),
    stages,
  });
}
beforeEach(() => {
  stub = installFoundry(14);
  user = { id: 'p', isGM: false };
  g.game.user = user;
  g.game.users = { get: (id: string) => (id === user.id ? user : undefined) };
  g.game.system = { id: 'unknown' };
  actor = new Actor();
  g.CONFIG = { Actor: { documentClass: Actor } };
  g.game.actors = new Map([['a', actor]]);
  g.fromUuid = vi.fn(async () => actor);
  selection.adapter = genericAdapter;
  records = [];
  seen = [];
  afterSnapshot = undefined;
});
afterEach(() => {
  stub.uninstall();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('five adapter tools through the dispatcher', () => {
  it.each([actorSummary, actionsList, inventory, conditions])(
    'reads $name without audit or write capabilities',
    async (tool) => {
      const result = await dispatcher()(call(tool.name), user);
      expect(result).toMatchObject({ structured: { actorUuid: 'Actor.a', systemId: 'unknown' } });
      expect(records).toEqual([]);
      expect(seen).toEqual(['policy:read', 'rate:read', 'approval:read']);
    },
  );
  it('keeps the public module pack API unchanged after all five handlers load', () => {
    const { api } = createPackApi(new ToolRegistry(() => {}), {
      active: () => true,
      translate: (k) => k,
    });
    g.game.modules = new Map([['agent-gateway', { api }]]);
    expect(Object.keys(g.game.modules.get('agent-gateway').api)).toEqual([
      'packApiVersion',
      'registerPack',
      'isSealed',
    ]);
  });
  it.each([
    'missing',
    'forged',
    'compendium',
    'synthetic',
    'parent',
    'unowned',
    'user-clone',
    'role-stale',
    'class-forged',
  ])('uniformly rejects %s before adapter invocation', async (mode) => {
    const fn = vi.fn(genericAdapter.actorSummary);
    selection.adapter = { ...genericAdapter, actorSummary: fn };
    if (mode === 'missing') g.fromUuid = async () => null;
    if (mode === 'forged') g.game.actors = new Map([['a', { ...actor }]]);
    if (mode === 'compendium') actor.pack = 'x';
    if (mode === 'synthetic') actor.isToken = true;
    if (mode === 'parent') actor.parent = {};
    if (mode === 'unowned') actor.owned = false;
    if (mode === 'user-clone') g.game.user = { ...user };
    if (mode === 'role-stale') g.game.user.isGM = true;
    if (mode === 'class-forged') actor = { ...actor };
    const identity = mode === 'role-stale' ? { id: user.id, isGM: false } : user;
    const result = await dispatcher()(call('actor_summary'), identity);
    expect(result).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(fn).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('Hero');
  });
  it('GM native permission bypass still respects current folder restrictions', async () => {
    user.isGM = true;
    actor.owned = false;
    expect(await dispatcher()(call('actor_summary'), user)).toMatchObject({
      structured: { name: 'Hero' },
    });
    await g.game.settings.set('agent-gateway', 'folderAllowlist', {
      gmAgents: ['private'],
      playerAgents: [],
    });
    expect(await dispatcher()(call('actor_summary'), user)).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
  });
  it('generic writes still escalate before every stage and invoke no native mutator', async () => {
    const update = vi.fn();
    actor.update = update;
    expect(
      await dispatcher()(
        call('conditions', { actorUuid: actor.uuid, change: { id: 'dead', active: true } }),
        user,
      ),
    ).toMatchObject({
      error: { code: 'INVALID_ARGS', message: 'Operation not supported for unknown' },
    });
    expect(seen).toEqual(['policy:write', 'rate:write', 'approval:write']);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe('write');
    expect(update).not.toHaveBeenCalled();
    expect(
      await dispatcher()(
        call('action_perform', { actorUuid: actor.uuid, actionId: 'attack' }),
        user,
      ),
    ).toMatchObject({ error: { code: 'INVALID_ARGS' } });
  });
  it('supported mutation gets only trusted context after an actual audit snapshot', async () => {
    const invoke = vi.fn((doc: any, id: any, opts: any, ctx: any) => {
      expect(doc).toBe(actor);
      expect(id).toBe('attack');
      expect(opts).toEqual({ target: 'inert' });
      expect(Object.isFrozen(opts)).toBe(true);
      expect(ctx.user).toBe(user);
      expect(Object.isFrozen(ctx)).toBe(true);
      expect(Object.isFrozen(user)).toBe(false);
      expect(ctx.callOptions.agentGateway.callId).toBe('entry-adapter01');
      expect(ctx.snapshot).toBeTypeOf('function');
      expect(ctx.intendCreate).toBeTypeOf('function');
      expect(ctx.created).toBeTypeOf('function');
      actor.name = 'Changed';
      return { completed: true, message: 'done' };
    });
    selection.adapter = { ...genericAdapter, performAction: invoke };
    expect(
      await dispatcher()(
        call('action_perform', {
          actorUuid: actor.uuid,
          actionId: 'attack',
          options: '{"target":"inert"}',
        }),
        user,
      ),
    ).toMatchObject({ structured: { completed: true } });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
    expect(records[0].targets[0].before.name).toBe('Hero');
    expect(records[0].status).toBe('ok');
  });
  it.each(['ownership', 'folder', 'identity', 'actor'])(
    'rechecks %s after the snapshot await',
    async (mode) => {
      const invoke = vi.fn(() => ({ completed: true, message: 'done' }));
      selection.adapter = { ...genericAdapter, performAction: invoke };
      afterSnapshot = () => {
        if (mode === 'ownership') actor.owned = false;
        if (mode === 'identity') g.game.user = { ...user };
        if (mode === 'actor') g.game.actors.clear();
        if (mode === 'folder')
          g.game.settings.set('agent-gateway', 'folderAllowlist', {
            playerAgents: ['private'],
            gmAgents: [],
          });
      };
      expect(
        await dispatcher()(
          call('action_perform', { actorUuid: actor.uuid, actionId: 'attack' }),
          user,
        ),
      ).toMatchObject({ error: { code: 'FORBIDDEN' } });
      expect(invoke).not.toHaveBeenCalled();
    },
  );
  it('rechecks ownership after the approval waits before admission', async () => {
    const invoke = vi.fn(genericAdapter.actorSummary);
    selection.adapter = { ...genericAdapter, actorSummary: invoke };
    const wait: Stage = {
      name: 'approval-change',
      order: 31,
      async run(_ctx, next) {
        await Promise.resolve();
        actor.owned = false;
        return next();
      },
    };
    expect(await dispatcher([wait])(call('actor_summary'), user)).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each(['ownership', 'folder'])(
    'refuses a write after %s is revoked while approval waits',
    async (mode) => {
      const invoke = vi.fn(() => ({ completed: true, message: 'done' }));
      selection.adapter = { ...genericAdapter, performAction: invoke };
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered!: () => void;
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const approval: Stage = {
        name: 'deferred-approval',
        order: 31,
        async run(ctx, next) {
          entered();
          await held;
          ctx.approved = true;
          return next();
        },
      };
      const result = dispatcher([approval])(
        call('action_perform', { actorUuid: actor.uuid, actionId: 'attack' }),
        user,
      );
      await waiting;
      if (mode === 'ownership') actor.owned = false;
      else
        await g.game.settings.set('agent-gateway', 'folderAllowlist', {
          playerAgents: ['private'],
          gmAgents: [],
        });
      release();
      expect(await result).toMatchObject({ error: { code: 'FORBIDDEN' } });
      expect(invoke).not.toHaveBeenCalled();
      expect(records).toHaveLength(1);
      expect(records[0].targets).toEqual([]);
    },
  );
  it.each(['throw', 'deep', 'cycle', 'getter', 'extra', 'oversize', 'wrong-type'])(
    'isolates %s adapter output and leaves subsequent calls usable',
    async (mode) => {
      const good = genericAdapter.actorSummary(actor);
      let bad: any = { ...good };
      if (mode === 'deep') {
        bad = {};
        let node = bad;
        for (let i = 0; i < 10000; i++) node = node.next = {};
      }
      if (mode === 'cycle') bad.self = bad;
      if (mode === 'getter')
        Object.defineProperty(bad, 'name', {
          enumerable: true,
          get() {
            throw Error('secret');
          },
        });
      if (mode === 'extra') bad.flags = { secret: 1 };
      if (mode === 'oversize') bad.name = 'x'.repeat(65537);
      if (mode === 'wrong-type') bad.name = ['Hero'];
      selection.adapter = {
        ...genericAdapter,
        actorSummary: () => {
          if (mode === 'throw') throw Error('secret');
          return bad;
        },
      };
      expect(await dispatcher()(call('actor_summary'), user)).toMatchObject({
        error: { code: 'INTERNAL' },
      });
      selection.adapter = genericAdapter;
      expect(await dispatcher()(call('actor_summary'), user)).toMatchObject({
        structured: { name: 'Hero' },
      });
    },
  );
  it('denied policy blocks the adapter and conditions changes before audit', async () => {
    const fn = vi.fn();
    selection.adapter = { ...genericAdapter, conditions: fn };
    const deny: Stage = {
      name: 'deny',
      order: 19,
      async run() {
        return { error: { code: 'DENIED', message: 'denied' } };
      },
    };
    expect(
      await dispatcher([deny])(
        call('conditions', { actorUuid: actor.uuid, change: { id: 'dead', active: true } }),
        user,
      ),
    ).toMatchObject({ error: { code: 'DENIED' } });
    expect(fn).not.toHaveBeenCalled();
    expect(records).toHaveLength(0);
  });
  it('real policy, rate and approval stages enforce the escalated conditions category', async () => {
    const allow = {
      read: 'allow',
      write: 'allow',
      destructive: 'deny',
      code: 'ask_owner',
    } as const;
    const world: any = { playerAgents: { ...allow, write: 'ask_owner' }, gmAgents: { ...allow } };
    const owner: any = { playerAgents: { ...allow }, gmAgents: { ...allow } };
    const request = vi.fn(async (ctx: any, category: string, next: any) => {
      expect(category).toBe('write');
      expect(ctx.approval).toEqual({ approver: 'owner' });
      ctx.approved = true;
      return next();
    });
    const methods = vi.fn((_doc: any, change: any, execution: any) => {
      if (change) expect(execution.callOptions.agentGateway.callId).toBe('entry-realstage');
      else expect(execution).toBeUndefined();
      return { supported: true, conditions: change ? [{ id: 'dead', name: 'Dead' }] : [] };
    });
    selection.adapter = { ...genericAdapter, conditions: methods };
    const inputs = () => ({ world, owner, playerAgentsEnabled: true, headlessAgentsEnabled: true });
    const stages = [
      createPolicyStage({ tools, inputs }),
      createRateLimitStage({
        tools,
        now: () => 0,
        limits: () =>
          loadLimits({
            playerAgents: { read: 2, write: 1 },
            gmAgents: { read: 2, write: 1 },
            agents: {},
          }),
      }),
      createApprovalStage(() => ({ request }) as any, tools),
      createAuditStage({
        categoryOf: (t) => tools.find((x) => x.name === t)?.category,
        isGM: () => true,
        fromUuid: async () => actor,
        submit: async (r) => {
          records.push(r);
        },
        newId: () => 'entry-realstage',
        now: () => 1,
        watchChanges: () => () => {},
      }),
    ];
    const dispatch = createDispatcher({
      tools,
      handlers: Object.fromEntries(tools.map((t) => [t.name, HANDLERS[t.name]!])),
      stages,
    });
    const mutation = () =>
      call('conditions', { actorUuid: actor.uuid, change: { id: 'dead', active: true } });
    expect(await dispatch(mutation(), user)).toMatchObject({
      structured: { supported: true, conditions: [{ id: 'dead' }] },
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
    expect(records[0].targets[0].before.name).toBe('Hero');
    expect(await dispatch(mutation(), user)).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(await dispatch(call('conditions'), user)).toMatchObject({
      structured: { conditions: [] },
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
    world.playerAgents.write = 'deny';
    expect(await dispatch(mutation(), user)).toMatchObject({ error: { code: 'DENIED' } });
    expect(methods).toHaveBeenCalledTimes(2);
  });
  it('ordinary read-class conditions cannot be replayed even with change', async () => {
    const request = call('conditions', {
      actorUuid: actor.uuid,
      change: { id: 'dead', active: true },
    });
    bindReplay(request, {
      id: 'r',
      expiresAt: Date.now() + 10000,
      current: () => true,
      report: () => {},
    });
    expect(await dispatcher()(request, user)).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(records).toHaveLength(0);
  });
});
describe('bounded inert adapter data', () => {
  it.each([
    '[]',
    'null',
    '1',
    '{"__proto__":{"user":"gm"}}',
    '{"constructor":"execute"}',
    '{"x":' + '['.repeat(13) + '0' + ']'.repeat(13) + '}',
  ])('refuses unsafe options %s', (raw) => expect(() => actionOptions(raw)).toThrow());
  it('does not evaluate options and rejects oversized flexible data before schema recursion', () => {
    expect(actionOptions('{"text":"game.user.isGM=true","method":"delete"}')).toEqual({
      text: 'game.user.isGM=true',
      method: 'delete',
    });
    expect(() => boundedAdapterData({ list: Array(513).fill('x') })).toThrow();
    expect(() => boundedAdapterData({ x: Infinity })).toThrow();
  });
});
