import { TOOLS, defineTool, toJsonSchema, type JsonSchemaObject } from '@agent-gateway/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createDispatcher, createRegistryDispatcher } from '../../../src/ops/dispatch.js';
import { coreEntry, registerCoreTools } from '../../../src/ops/core-tools.js';
import {
  RegistryError,
  ToolRegistry,
  toolRegistry,
  type RegistryEntry,
  type RegistryLookup,
} from '../../../src/ops/registry.js';
import type { OpContext } from '../../../src/ops/types.js';
import { STAGES, type Stage } from '../../../src/ops/stages.js';
import { createPolicyStage } from '../../../src/policy/stage.js';
import { createRateLimitStage } from '../../../src/ratelimit/stage.js';
import { loadLimits } from '../../../src/ratelimit/config.js';
import { SlidingWindowLimiter } from '../../../src/ratelimit/limiter.js';
import { callHash } from '../../../src/approvals/canonical.js';
import { HANDLERS } from '../../../src/tools/index.js';
import { Hub } from '../../stubs/approvals.js';
import { installFoundry } from '../../stubs/foundry.js';

const schema = (): JsonSchemaObject => ({
  type: 'object',
  properties: { value: { type: 'string', description: 'A value' } },
  additionalProperties: false,
});
const entry = (name = 'world_info'): RegistryEntry => ({
  name,
  category: 'read',
  minRole: 'player',
  description: 'A fixture tool',
  inputSchema: schema(),
  outputSchema: schema(),
  origin: 'core',
  parseArgs: (data) => ({ ok: true, data }),
  handler: () => ({ text: 'original', structured: {} }),
});
const call = (tool = 'world_info') => ({
  tool,
  args: {},
  agent: { id: 'agent', ownerUserId: 'user', headless: false },
  sessionId: 'session',
});
const user = { id: 'user', isGM: true };
function rig(stages: readonly Stage[] = []) {
  let lookup!: RegistryLookup;
  const registry = new ToolRegistry((captured) => {
    lookup = captured;
  });
  return { registry, dispatch: createRegistryDispatcher(registry, lookup, stages) };
}
afterEach(() => vi.restoreAllMocks());

describe('tool registry', () => {
  it('refuses duplicates without replacing the original implementation', async () => {
    const { registry, dispatch } = rig();
    registry.register(entry());
    expect(() =>
      registry.register({ ...entry(), handler: () => ({ text: 'replacement', structured: {} }) }),
    ).toThrow(RegistryError);
    expect(await dispatch(call(), user)).toMatchObject({ text: 'original' });
  });

  it.each(['admin', undefined, 'READ'])('refuses invalid category %s', (category) => {
    const registry = new ToolRegistry();
    expect(() => registry.register({ ...entry(), category } as RegistryEntry)).toThrow(
      RegistryError,
    );
    expect(registry.list()).toEqual([]);
  });

  it('refuses invalid roles and invalid definitions', () => {
    const registry = new ToolRegistry();
    expect(() =>
      registry.register({ ...entry(), minRole: 'owner' } as unknown as RegistryEntry),
    ).toThrow(RegistryError);
    const invalid = entry();
    delete (invalid.inputSchema.properties as Record<string, JsonSchemaObject>).value!.description;
    expect(() => registry.register(invalid)).toThrow(/missing description/);
  });

  it('validates pack origin metadata and names through the protocol rules', () => {
    const registry = new ToolRegistry();
    const pack = {
      ...entry('odds-roll'),
      origin: { packId: 'dice-odds', version: '1.0.0', prefix: 'odds' },
    };
    registry.register(pack);
    expect(registry.info('odds-roll')?.origin).toEqual(pack.origin);
    expect(() => registry.register({ ...entry('other-roll'), origin: pack.origin })).toThrow(
      /prefix mismatch/,
    );
    expect(() =>
      registry.register({ ...entry(), origin: undefined } as unknown as RegistryEntry),
    ).toThrow(RegistryError);
  });

  it('registerAll is atomic and sealing refuses every later registration', () => {
    const { registry } = rig();
    registry.register(entry());
    const before = registry.list();
    expect(() =>
      registry.registerAll([
        entry('first_tool'),
        entry('second_tool'),
        { ...entry('third_tool'), category: undefined } as unknown as RegistryEntry,
      ]),
    ).toThrow(RegistryError);
    expect(registry.list()).toEqual(before);
    registry.seal();
    expect(() => registry.register(entry('another_tool'))).toThrow(/sealed/);
    expect(() => registry.registerAll([])).toThrow(/sealed/);
  });

  it('exposes only deeply frozen metadata, isolated from registration objects', () => {
    const registry = new ToolRegistry();
    const original = entry();
    registry.register(original);
    (original.inputSchema.properties as Record<string, JsonSchemaObject>).value!.description =
      'Changed';
    const walk = (value: unknown) => {
      expect(typeof value).not.toBe('function');
      if (value !== null && typeof value === 'object') {
        expect(Object.isFrozen(value)).toBe(true);
        for (const child of Object.values(value)) walk(child);
      }
    };
    walk(registry.info('world_info'));
    walk(registry.list());
    expect(JSON.stringify(registry.info('world_info'))).not.toContain('Changed');
    expect(Object.getOwnPropertyNames(toolRegistry)).toEqual([]);
    expect(registry.categoryOf('missing')).toBeUndefined();
  });

  it('filters GM tools while retaining immutable metadata', () => {
    const registry = new ToolRegistry();
    registry.registerAll([entry(), { ...entry('private_tool'), minRole: 'gm' }]);
    expect(registry.forRole(false).map((tool) => tool.name)).toEqual(['world_info']);
    expect(registry.forRole(true)).toHaveLength(2);
  });

  it('registers core schemas unchanged, through the same registerAll path', () => {
    const registry = new ToolRegistry();
    const register = vi.spyOn(registry, 'registerAll');
    registerCoreTools(registry);
    expect(register).toHaveBeenCalledOnce();
    expect(registry.list().map((tool) => tool.name)).toEqual(TOOLS.map((tool) => tool.name));
    for (const tool of TOOLS) expect(registry.info(tool.name)).toMatchObject(toJsonSchema(tool));
  });

  it('refuses either direction of core handler mismatch before installing anything', () => {
    const registry = new ToolRegistry();
    const { world_info: _removed, ...handlers } = HANDLERS;
    void _removed;
    expect(() => registerCoreTools(registry, TOOLS, handlers)).toThrow(/world_info/);
    expect(() =>
      registerCoreTools(registry, TOOLS, { ...HANDLERS, unknown_tool: HANDLERS.world_info! }),
    ).toThrow(/unknown_tool/);
    expect(registry.list()).toEqual([]);
  });

  it('keeps original Zod defaults and argument validation in the compatibility adapter', async () => {
    const tool = defineTool({
      name: 'legacy_tool',
      category: 'read',
      minRole: 'player',
      handledBy: 'module',
      description: 'Legacy fixture',
      input: z.strictObject({ n: z.number().default(3) }),
      output: z.strictObject({}),
    });
    expect(() =>
      new ToolRegistry().register(coreEntry(tool, () => ({ text: '', structured: {} }))),
    ).toThrow(/missing description/);
    const handler = vi.fn((ctx: OpContext) => ({ text: 'ok', structured: { args: ctx.args } }));
    const dispatch = createDispatcher({
      tools: [tool],
      handlers: { legacy_tool: handler },
      stages: [],
    });
    expect(await dispatch(call('legacy_tool'), user)).toMatchObject({ text: 'ok' });
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ args: { n: 3 } });
    expect(await dispatch({ ...call('legacy_tool'), args: { n: 'bad' } }, user)).toMatchObject({
      error: { code: 'INVALID_ARGS' },
    });
  });
});

describe('registry pipeline integration', () => {
  it('runs every documented stage in order and respects short circuits', async () => {
    const seen: number[] = [];
    const orders = [40, 10, 30, 25, 20];
    const stages = orders.map((order): Stage => ({
      name: `stage-${order}`,
      order,
      run: async (_ctx, next) => {
        seen.push(order);
        return next();
      },
    }));
    const { registry, dispatch } = rig(stages);
    const handler = vi.fn(() => {
      seen.push(100);
      return { text: 'ok', structured: {} };
    });
    registry.register({ ...entry(), handler });
    await dispatch(call(), user);
    expect(seen).toEqual([10, 20, 25, 30, 40, 100]);
    expect(STAGES.map((stage) => stage.order).sort()).toEqual([20, 25, 30, 40]);
    stages.find((stage) => stage.order === 20)!.run = async () => ({
      error: { code: 'DENIED', message: 'blocked' },
    });
    handler.mockClear();
    expect(await dispatch(call(), user)).toMatchObject({ error: { code: 'DENIED' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('denies an unknown registry category and charges it as a write', async () => {
    const stub = installFoundry(14);
    try {
      vi.spyOn(toolRegistry, 'categoryOf').mockReturnValue(undefined);
      const context = { ...call(), user };
      const next = vi.fn(async () => ({ text: 'ok', structured: {} }));
      expect(await createPolicyStage().run(context, next)).toMatchObject({
        error: { code: 'DENIED' },
      });
      expect(next).not.toHaveBeenCalled();
      const limiter = new SlidingWindowLimiter(() => 0);
      const take = vi.spyOn(limiter, 'take');
      const rate = createRateLimitStage({
        limiter,
        limits: () =>
          loadLimits({ playerAgents: { read: 1, write: 1 }, gmAgents: { read: 1, write: 1 } }),
      });
      await rate.run(context, next);
      expect(take).toHaveBeenCalledWith('agent\u0000write', 1);
    } finally {
      stub.uninstall();
    }
  });

  it('approvers drop relay requests unknown to their registry', () => {
    const hub = new Hub();
    hub.addUser('player', false);
    hub.addUser('gm', true);
    const gm = hub.client('gm');
    const send = (tool: string, id: string) =>
      hub.deliver('player', {
        t: 'approval.request',
        id,
        tool,
        args: {},
        argsHash: callHash(tool, {}),
        agentId: 'agent',
        sessionId: 'session',
        approver: 'gm',
        createdAt: hub.now,
        expiresAt: hub.now + 10_000,
        category: 'code',
      });
    send('unknown_tool', 'unknown-request-1234567890');
    expect(gm.manager.listPending()).toEqual([]);
    send('world_info', 'known-request-123456789012');
    expect(gm.manager.listPending()).toHaveLength(1);
    expect(gm.manager.listPending()[0]?.category).toBe('read');
  });
});
