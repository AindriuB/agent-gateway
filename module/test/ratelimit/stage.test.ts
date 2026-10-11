/* eslint-disable @typescript-eslint/no-explicit-any */
import { defineTool, type ToolCategory } from '@agent-gateway/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createDispatcher } from '../../src/ops/dispatch.js';
import { STAGES } from '../../src/ops/stages.js';
import type { OpAgent } from '../../src/ops/types.js';
import { createPolicyStage } from '../../src/policy/stage.js';
import { registerPolicySettings } from '../../src/policy/store.js';
import { DEFAULT_LIMITS } from '../../src/ratelimit/config.js';
import { createRateLimitStage, RATE_LIMIT_STAGE_ORDER } from '../../src/ratelimit/stage.js';
import {
  loadRateLimits,
  registerRateLimitSettings,
  saveRateLimits,
} from '../../src/ratelimit/store.js';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';
import { englishI18n, setSetting } from '../policy/helpers.js';

let stub: FoundryStub;
afterEach(() => stub?.uninstall());

const tool = (category: ToolCategory) =>
  defineTool({
    name: `${category}_thing`,
    minRole: 'player',
    category,
    handledBy: 'module',
    description: 'x',
    input: z.strictObject({ id: z.string() }),
    output: z.strictObject({}),
  });
const tools = (['read', 'write', 'destructive', 'code'] as const).map(tool);
const handler = vi.fn(async () => ({ text: 'ran', structured: {} }));
const handlers = Object.fromEntries(tools.map((t) => [t.name, handler]));

const agent: OpAgent = { id: 'a', ownerUserId: 'u', headless: false };
const player = { id: 'u', isGM: false };
const gm = { id: 'g', isGM: true };

async function setup(withPolicy = false) {
  stub = installFoundry(14, { persistedWorldSettings: true });
  (globalThis as any).game.user = { id: 'gm', isGM: true };
  (globalThis as any).game.i18n = englishI18n;
  registerPolicySettings();
  registerRateLimitSettings();
  // The stub holds a generous limit and enabled player agents for other suites; start from the defaults.
  await setSetting('rateLimits', JSON.stringify(DEFAULT_LIMITS));
  handler.mockClear();
  const clock = { t: 5_000 };
  const stages = [createRateLimitStage({ tools, now: () => clock.t })];
  if (withPolicy) stages.push(createPolicyStage({ tools }));
  return { clock, dispatch: createDispatcher({ tools, handlers, stages }) };
}
type Setup = Awaited<ReturnType<typeof setup>>;
const call = (
  s: Setup,
  category: ToolCategory,
  user = gm,
  a: OpAgent = agent,
  args: unknown = { id: 'x' },
) => s.dispatch({ tool: `${category}_thing`, args, agent: a, sessionId: 's' }, user);
const limits = (o: Record<string, unknown>) =>
  setSetting('rateLimits', JSON.stringify({ ...DEFAULT_LIMITS, ...o }));

describe('rate-limit stage', () => {
  it('runs at order 25, between policy (20) and approval (30)', () => {
    expect(RATE_LIMIT_STAGE_ORDER).toBe(25);
    expect(STAGES.map((s) => s.name)).toContain('rate-limit');
    expect(STAGES.find((s) => s.name === 'rate-limit')?.order).toBe(25);
    expect(STAGES.find((s) => s.name === 'policy')?.order).toBe(20);
  });

  it('refuses the 11th write in a minute with RATE_LIMITED and a structured retryAfterSeconds', async () => {
    const s = await setup();
    for (let i = 0; i < 10; i++) expect(await call(s, 'write')).toMatchObject({ text: 'ran' });
    s.clock.t += 20_500;
    const r = (await call(s, 'write')) as any;
    expect(r.error.code).toBe('RATE_LIMITED');
    expect(r.retryAfterSeconds).toBe(40);
    expect(Number.isInteger(r.retryAfterSeconds)).toBe(true);
    expect(r.error.message).toMatch(/10 write calls per minute.*40 seconds/);
    expect(handler).toHaveBeenCalledTimes(10);
  });

  it('admits again once the window has passed', async () => {
    const s = await setup();
    await limits({ playerAgents: { read: 1, write: 1 } });
    await call(s, 'read', player);
    expect(((await call(s, 'read', player)) as any).error.code).toBe('RATE_LIMITED');
    s.clock.t += 60_000;
    expect(await call(s, 'read', player)).toMatchObject({ text: 'ran' });
  });

  it('read and write have separate budgets; destructive and code spend the write budget', async () => {
    const s = await setup();
    await limits({ gmAgents: { read: 1, write: 2 } });
    await call(s, 'destructive');
    await call(s, 'code');
    expect(((await call(s, 'write')) as any).error.code).toBe('RATE_LIMITED');
    expect(await call(s, 'read')).toMatchObject({ text: 'ran' });
    expect(((await call(s, 'read')) as any).error.code).toBe('RATE_LIMITED');
  });

  it('budgets are per agent', async () => {
    const s = await setup();
    await limits({ gmAgents: { read: 1, write: 1 } });
    await call(s, 'read', gm, agent);
    expect(await call(s, 'read', gm, { ...agent, id: 'b' })).toMatchObject({ text: 'ran' });
    expect(((await call(s, 'read', gm, agent)) as any).error.code).toBe('RATE_LIMITED');
  });

  it('uses the class of the calling user, and a per-agent override beats the class limit', async () => {
    const s = await setup();
    await limits({
      playerAgents: { read: 1, write: 1 },
      gmAgents: { read: 3, write: 3 },
      agents: { vip: { read: 2 } },
    });
    await call(s, 'read', player);
    expect(((await call(s, 'read', player)) as any).error.code).toBe('RATE_LIMITED');
    const vip = { ...agent, id: 'vip' };
    await call(s, 'read', player, vip);
    await call(s, 'read', player, vip);
    expect(((await call(s, 'read', player, vip)) as any).error.code).toBe('RATE_LIMITED');
  });

  it('applies a changed setting to the next call', async () => {
    const s = await setup();
    await limits({ gmAgents: { read: 1, write: 1 } });
    await call(s, 'read');
    expect(((await call(s, 'read')) as any).error.code).toBe('RATE_LIMITED');
    await limits({ gmAgents: { read: 5, write: 1 } });
    expect(await call(s, 'read')).toMatchObject({ text: 'ran' });
  });

  it('a corrupt saved setting limits to one call a minute, not unlimited', async () => {
    const s = await setup();
    await setSetting('rateLimits', '{corrupt');
    expect(await call(s, 'read')).toMatchObject({ text: 'ran' });
    expect(((await call(s, 'read')) as any).error.code).toBe('RATE_LIMITED');
  });

  it('a settings read that throws limits strictly', async () => {
    const s = await setup();
    (globalThis as any).game.settings.get = () => {
      throw new Error('boom');
    };
    await call(s, 'write');
    expect(((await call(s, 'write')) as any).error.code).toBe('RATE_LIMITED');
  });
});

describe('rejected calls do not spend budget', () => {
  it('invalid args never reach the stage', async () => {
    const s = await setup();
    await limits({ gmAgents: { read: 1, write: 1 } });
    for (let i = 0; i < 5; i++) {
      expect(((await call(s, 'read', gm, agent, { nope: 1 })) as any).error.code).toBe(
        'INVALID_ARGS',
      );
    }
    expect(await call(s, 'read')).toMatchObject({ text: 'ran' });
  });

  it('a policy deny (stage order 20) costs nothing', async () => {
    const s = await setup(true);
    await setSetting('playerAgentsEnabled', false);
    await limits({ playerAgents: { read: 1, write: 1 } });
    // Player agents are off, so policy denies; none of these may spend the single read.
    for (let i = 0; i < 5; i++) {
      expect(((await call(s, 'read', player)) as any).error.code).toBe('DENIED');
    }
    await setSetting('playerAgentsEnabled', true);
    expect(await call(s, 'read', player)).toMatchObject({ text: 'ran' });
    expect(((await call(s, 'read', player)) as any).error.code).toBe('RATE_LIMITED');
  });

  it('a rate-limited call does not spend budget either', async () => {
    const s = await setup();
    await limits({ gmAgents: { read: 1, write: 1 } });
    await call(s, 'read');
    for (let i = 0; i < 5; i++) await call(s, 'read');
    s.clock.t += 60_000;
    expect(await call(s, 'read')).toMatchObject({ text: 'ran' });
  });
});

describe('settings store', () => {
  it('the registered default is 60 read and 10 write per minute for both classes, no overrides', async () => {
    await setup();
    const reg = stub.registeredSettings.get('agent-gateway.rateLimits') as any;
    expect(reg.scope).toBe('world');
    expect(JSON.parse(reg.default)).toEqual({
      playerAgents: { read: 60, write: 10 },
      gmAgents: { read: 60, write: 10 },
      agents: {},
    });
  });

  it('registers the default and loads it', async () => {
    await setup();
    const l = loadRateLimits();
    expect(l.classes.playerAgents).toEqual({ read: 60, write: 10 });
    expect(l.classes.gmAgents).toEqual({ read: 60, write: 10 });
  });

  it('saveRateLimits stores valid limits and rejects invalid ones without writing', async () => {
    await setup();
    await saveRateLimits({ ...DEFAULT_LIMITS, agents: { z: { write: 2 } } });
    expect(loadRateLimits().agents.get('z')).toEqual({ write: 2 });
    await expect(
      saveRateLimits({ ...DEFAULT_LIMITS, gmAgents: { read: 0, write: 1 } }),
    ).rejects.toThrow();
    expect(loadRateLimits().classes.gmAgents.read).toBe(60);
  });
});
