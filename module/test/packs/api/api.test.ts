import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPackApi,
  PackError,
  type PackContext,
  type PackSpec,
} from '../../../src/packs/api.js';
import { createRegistryDispatcher } from '../../../src/ops/dispatch.js';
import { ToolRegistry, type RegistryLookup } from '../../../src/ops/registry-class.js';
import type { OpContext } from '../../../src/ops/types.js';
import type { Stage } from '../../../src/ops/stages.js';
import { installFoundry } from '../../stubs/foundry.js';

const schema = () => ({ type: 'object', properties: {}, additionalProperties: false });
const spec = (id = 'test-pack', prefix = 'world'): PackSpec => ({
  id,
  prefix,
  version: '1.0.0',
  apiVersion: '1.0',
  tools: [
    {
      name: 'info',
      category: 'read',
      minRole: 'player',
      description: 'Pack information',
      inputSchema: schema(),
      outputSchema: schema(),
      handler: () => ({ text: 'pack', structured: {} }),
    },
  ],
});
const call = (tool = 'world-info') => ({
  tool,
  args: {},
  agent: { id: 'agent', ownerUserId: 'owner', headless: false },
  sessionId: 'session',
});
const user = { id: 'owner', isGM: true };
function rig(stages: Stage[] = []) {
  let lookup!: RegistryLookup;
  const registry = new ToolRegistry((value) => {
    lookup = value;
  });
  const lifecycle = createPackApi(registry, {
    active: (id) => id !== 'disabled' && id !== 'unknown',
    translate: () => 'Use the registration hook',
  });
  return { ...lifecycle, registry, dispatch: createRegistryDispatcher(registry, lookup, stages) };
}
function refusal(fn: () => void, code: string) {
  try {
    fn();
    throw new Error('Expected refusal');
  } catch (error) {
    expect(error).toBeInstanceOf(PackError);
    expect(error).toMatchObject({ code });
  }
}
beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('public pack registration', () => {
  it('exposes exactly three immutable keys without registry capabilities', () => {
    const { api } = rig();
    expect(Object.keys(api)).toEqual(['packApiVersion', 'registerPack', 'isSealed']);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.getPrototypeOf(api)).toBe(Object.prototype);
    expect(() => Object.assign(api, { registerPack: () => {}, dispatch: () => {} })).toThrow();
    expect(api.packApiVersion).toBe('1.0');
  });
  it('namespaces with a hyphen and refuses prefix takeover without changing handlers', async () => {
    const { api, registry, dispatch } = rig();
    registry.register({
      name: 'world_info',
      description: 'Core information',
      category: 'read',
      minRole: 'player',
      inputSchema: schema(),
      outputSchema: schema(),
      origin: 'core',
      parseArgs: (data) => ({ ok: true, data }),
      handler: () => ({ text: 'core', structured: {} }),
    });
    api.registerPack(spec());
    refusal(() => api.registerPack(spec('other', 'world')), 'PREFIX_TAKEN');
    refusal(() => api.registerPack(spec('other', 'ag')), 'PREFIX_TAKEN');
    expect(await dispatch(call('world_info'), user)).toMatchObject({ text: 'core' });
    expect(await dispatch(call(), user)).toMatchObject({ text: 'pack' });
  });
  it.each([undefined, null, 'admin', 'Read'])('rejects category %s atomically', (category) => {
    const { api, registry } = rig();
    const input = spec();
    input.tools.push({ ...input.tools[0]!, name: 'second', category } as PackSpec['tools'][number]);
    refusal(() => api.registerPack(input), 'INVALID_TOOL');
    expect(registry.list()).toEqual([]);
    expect(console.error).toHaveBeenCalledOnce();
  });
  it.each(['disabled', 'unknown', 'agent-gateway'])('refuses inactive or core id %s', (id) => {
    const { api, registry } = rig();
    refusal(() => api.registerPack(spec(id)), 'INACTIVE');
    expect(registry.list()).toEqual([]);
  });
  it.each(['2.0', 'bad', '', null])('refuses unsupported API version %s', (apiVersion) => {
    const { api } = rig();
    refusal(() => api.registerPack({ ...spec(), apiVersion } as PackSpec), 'API_VERSION');
  });
  it('accepts compatible minor versions, refuses duplicate ids and sealed registration', () => {
    const { api, seal } = rig();
    api.registerPack({ ...spec(), apiVersion: '1.7' });
    refusal(() => api.registerPack(spec('test-pack', 'other')), 'DUPLICATE');
    seal();
    expect(api.isSealed()).toBe(true);
    refusal(() => api.registerPack(spec('other', 'other')), 'SEALED');
    expect(console.error).toHaveBeenCalledTimes(2);
  });
  it.each(['handler', 'schema', 'count', 'duplicate', 'id', 'version', 'prefix'])(
    'rejects invalid %s atomically',
    (problem) => {
      const { api, registry } = rig();
      const input = spec();
      if (problem === 'handler') Object.assign(input.tools[0]!, { handler: null });
      if (problem === 'schema') input.tools[0]!.inputSchema.anyOf = [];
      if (problem === 'count') input.tools = Array.from({ length: 33 }, () => input.tools[0]!);
      if (problem === 'duplicate') input.tools.push(input.tools[0]!);
      if (problem === 'id') input.id = 'Bad ID';
      if (problem === 'version') input.version = 'bad';
      if (problem === 'prefix') input.prefix = 'a';
      refusal(() => api.registerPack(input), 'INVALID_TOOL');
      expect(registry.list()).toEqual([]);
    },
  );
  it.each([false, true])('reads getters once and isolates later mutations (proxy %s)', (proxy) => {
    const { api, registry } = rig();
    const input = spec();
    const originalSchema = schema();
    let reads = 0;
    Object.defineProperty(input.tools[0]!, 'inputSchema', {
      enumerable: true,
      get: () => (++reads === 1 ? originalSchema : { anyOf: [] }),
    });
    const observed = new Map<PropertyKey, number>();
    const submitted = proxy
      ? new Proxy(input, {
          get: (target, key, receiver) => {
            observed.set(key, (observed.get(key) ?? 0) + 1);
            return Reflect.get(target, key, receiver);
          },
        })
      : input;
    api.registerPack(submitted);
    expect(reads).toBe(1);
    for (const count of observed.values()) expect(count).toBe(1);
    originalSchema.type = 'array';
    input.tools[0]!.description = 'changed';
    expect(registry.info('world-info')?.inputSchema.type).toBe('object');
    expect(registry.info('world-info')?.description).toBe('Pack information');
  });
  it('captures a hostile array length once without invoking caller map methods', () => {
    const { api, registry } = rig();
    const input = spec();
    const many = Array.from({ length: 33 }, (_, index) => ({
      ...input.tools[0]!,
      name: `info${index}`,
    }));
    let lengthReads = 0;
    input.tools = new Proxy(many, {
      get: (target, key, receiver) => {
        if (key === 'length') return ++lengthReads === 1 ? 1 : 33;
        if (key === 'map') throw new Error('Caller map must not run');
        return Reflect.get(target, key, receiver);
      },
    });
    api.registerPack(input);
    expect(lengthReads).toBe(1);
    expect(registry.list()).toHaveLength(1);
    expect(registry.info('world-info0')).toBeDefined();
  });
  it('wraps throwing accessors and cycles as a single registration refusal', () => {
    const { api, registry } = rig();
    const input = spec();
    Object.defineProperty(input, 'tools', {
      get: () => {
        throw new Error('hostile');
      },
    });
    refusal(() => api.registerPack(input), 'INVALID_TOOL');
    expect(registry.list()).toEqual([]);
    expect(console.error).toHaveBeenCalledOnce();
  });
});

describe('pack execution isolation', () => {
  it('runs every stage and denies policy or missing approval before the handler', async () => {
    const seen: number[] = [];
    const stages = [50, 10, 40, 20, 30].map((order): Stage => ({
      name: String(order),
      order,
      run: (_ctx, next) => {
        seen.push(order);
        return next();
      },
    }));
    const { api, dispatch } = rig(stages);
    const input = spec();
    const handler = vi.fn(() => {
      seen.push(100);
      return { text: 'ok', structured: {} };
    });
    input.tools[0]!.handler = handler;
    api.registerPack(input);
    await dispatch(call(), user);
    expect(seen).toEqual([10, 20, 30, 40, 50, 100]);
    handler.mockClear();
    const policy = stages.find((stage) => stage.order === 20)!;
    policy.run = () => ({ error: { code: 'DENIED', message: 'policy' } });
    expect(await dispatch(call(), user)).toMatchObject({ error: { code: 'DENIED' } });
    expect(handler).not.toHaveBeenCalled();
    policy.run = (ctx, next) => {
      ctx.approval = { approver: 'gm' };
      return next();
    };
    expect(await dispatch(call(), user)).toMatchObject({ error: { code: 'DENIED' } });
    expect(handler).not.toHaveBeenCalled();
  });
  it('refuses player access to GM tools before running any stage', async () => {
    const stage = vi.fn(
      (_ctx: OpContext, next: () => Promise<import('../../../src/ops/types.js').DispatchResult>) =>
        next(),
    );
    const { api, dispatch } = rig([{ name: 'spy', order: 10, run: stage }]);
    const input = spec();
    input.tools[0]!.minRole = 'gm';
    api.registerPack(input);
    expect(await dispatch(call(), { ...user, isGM: false })).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
    expect(stage).not.toHaveBeenCalled();
  });
  it('validates input schemas and applies defaults', async () => {
    const { api, dispatch } = rig();
    const input = spec();
    input.tools[0]!.inputSchema = {
      type: 'object',
      additionalProperties: false,
      properties: { count: { type: 'integer', description: 'Count', default: 3 } },
    };
    const handler = vi.fn(() => ({ text: 'ok', structured: {} }));
    input.tools[0]!.handler = handler;
    api.registerPack(input);
    expect(await dispatch({ ...call(), args: { count: 'bad' } }, user)).toMatchObject({
      error: { code: 'INVALID_ARGS' },
    });
    expect(handler).not.toHaveBeenCalled();
    await dispatch(call(), user);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ args: { count: 3 } }));
  });
  it('freezes a detached context and forwards only bound audit functions', async () => {
    let live!: OpContext;
    let received!: PackContext;
    const snapshot = vi.fn(async () => {});
    const created = vi.fn(async () => {});
    const intendCreate = vi.fn(async () => {});
    const { api, registry, dispatch } = rig([
      {
        name: 'audit',
        order: 40,
        run: async (ctx, next) => {
          live = ctx;
          ctx.snapshot = snapshot;
          ctx.created = created;
          ctx.intendCreate = intendCreate;
          ctx.callOptions = { agentGateway: { callId: 'audit' } };
          const result = await next();
          expect(ctx.tool).toBe('world-info');
          expect(ctx.approved).toBeUndefined();
          return result;
        },
      },
    ]);
    const input = spec();
    input.tools[0]!.handler = async (ctx) => {
      received = ctx;
      expect(() => Object.assign(ctx, { approved: true })).toThrow();
      expect(() => Object.assign(ctx, { tool: 'script_run' })).toThrow();
      await ctx.snapshot?.('Actor.one');
      await ctx.created?.('Actor.two');
      await ctx.intendCreate?.();
      return { text: 'ok', structured: {} };
    };
    api.registerPack(input);
    expect(await dispatch(call(), user)).toMatchObject({ text: 'ok' });
    expect(received).not.toBe(live);
    expect(received.user).not.toBe(live.user);
    expect(received.callOptions).not.toBe(live.callOptions);
    expect(received.agent).not.toHaveProperty('ownerUserId');
    expect(snapshot).toHaveBeenCalledWith('Actor.one');
    expect(created).toHaveBeenCalledWith('Actor.two');
    expect(intendCreate).toHaveBeenCalled();
    const forbidden: unknown[] = [live, registry, dispatch, input.tools[0]!.handler];
    const walk = (value: unknown, depth = 0, visited = new Set<unknown>()) => {
      expect(forbidden).not.toContain(value);
      if (
        !value ||
        !['object', 'function'].includes(typeof value) ||
        depth > 3 ||
        visited.has(value)
      )
        return;
      visited.add(value);
      if (typeof value === 'object' && value !== Object.prototype)
        expect(Object.isFrozen(value)).toBe(true);
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value)))
        if ('value' in descriptor) walk(descriptor.value, depth + 1, visited);
      walk(Object.getPrototypeOf(value), depth + 1, visited);
    };
    walk(api);
    walk(received);
  });
  it.each([
    'throws',
    'string',
    'text',
    'schema',
    'large',
    'large-structured',
    'error',
    'long-error',
    'array-forbidden-code',
    'array-invalid-args-code',
    'cycle',
  ])('contains invalid result %s to one call', async (problem) => {
    const { api, registry, dispatch } = rig();
    const input = spec();
    input.tools[0]!.handler = () => {
      if (problem === 'throws') throw new Error('broken');
      if (problem === 'string') return 'bad';
      if (problem === 'text') return { text: 1 };
      if (problem === 'schema') return { text: 'ok', structured: { extra: true } };
      if (problem === 'large') return { text: 'x'.repeat(65 * 1024), structured: {} };
      if (problem === 'large-structured')
        return { text: 'ok', structured: { extra: 'x'.repeat(65 * 1024) } };
      if (problem === 'error') return { error: { code: 'DENIED', message: 'no' } };
      if (problem === 'array-forbidden-code')
        return { error: { code: ['FORBIDDEN'], message: 'Malformed code' } };
      if (problem === 'array-invalid-args-code')
        return { error: { code: ['INVALID_ARGS'], message: 'Malformed code' } };
      if (problem === 'long-error')
        return { error: { code: 'FORBIDDEN', message: 'x'.repeat(501) } };
      const cycle: Record<string, unknown> = {};
      cycle.self = cycle;
      return cycle;
    };
    api.registerPack(input);
    api.registerPack(spec('second-pack', 'other'));
    registry.register({
      name: 'core_test',
      description: 'Core test',
      category: 'read',
      minRole: 'player',
      inputSchema: schema(),
      outputSchema: schema(),
      origin: 'core',
      parseArgs: (data) => ({ ok: true, data }),
      handler: () => ({ text: 'core', structured: {} }),
    });
    expect(await dispatch(call(), user)).toMatchObject({ error: { code: 'INTERNAL' } });
    expect(await dispatch(call('core_test'), user)).toMatchObject({ text: 'core' });
    expect(await dispatch(call('other-info'), user)).toMatchObject({ text: 'pack' });
  });
  it.each(['FORBIDDEN', 'INVALID_ARGS'])('allows safe pack error %s', async (code) => {
    const { api, dispatch } = rig();
    const input = spec();
    input.tools[0]!.handler = () => ({ error: { code, message: 'Pack refusal' } });
    api.registerPack(input);
    expect(await dispatch(call(), user)).toEqual({ error: { code, message: 'Pack refusal' } });
  });
});

it.each([13, 14] as const)(
  'installs on init, registers on setup, seals at ready and survives approvals v%s',
  async (generation) => {
    vi.resetModules();
    const stub = installFoundry(generation);
    try {
      const globals = globalThis as unknown as {
        game: {
          modules: Map<
            string,
            { active: boolean; api?: import('../../../src/packs/api.js').PackApi }
          >;
        };
        Hooks: {
          on(name: string, fn: (api: import('../../../src/packs/api.js').PackApi) => void): void;
        };
      };
      globals.game.modules.set('test-pack', { active: true });
      await import('../../../src/main.js');
      stub.fire('init');
      const api = globals.game.modules.get('agent-gateway')!.api!;
      globals.Hooks.on('agentGateway.registerPacks', (hookApi) => {
        expect(hookApi).toBe(api);
        hookApi.registerPack(spec());
      });
      stub.fire('setup');
      expect(api.isSealed()).toBe(false);
      stub.fire('ready');
      expect(api.isSealed()).toBe(true);
      const { startApprovals } = await import('../../../src/approvals/live.js');
      startApprovals();
      expect(globals.game.modules.get('agent-gateway')!.api).toBe(api);
      expect(Object.keys(api)).toEqual(['packApiVersion', 'registerPack', 'isSealed']);
      expect(Object.isFrozen(api)).toBe(true);
      try {
        api.registerPack(spec());
      } catch (error) {
        expect(error).toMatchObject({ code: 'SEALED' });
      }
    } finally {
      stub.uninstall();
    }
  },
);
