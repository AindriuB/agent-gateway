/* eslint-disable @typescript-eslint/no-explicit-any */
import { defineTool, type ToolCategory } from '@agent-gateway/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createDispatcher } from '../../src/ops/dispatch.js';
import { STAGES } from '../../src/ops/stages.js';
import type { OpAgent, OpContext } from '../../src/ops/types.js';
import { createPolicyStage, liveInputs, policyStage } from '../../src/policy/stage.js';
import {
  saveOwnerPolicy,
  saveWorldPolicy,
  registerPolicySettings,
} from '../../src/policy/store.js';
import { DEFAULT_WORLD_MATRIX, type PolicyMatrix } from '../../src/policy/matrix.js';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';
import { englishI18n, setSetting } from './helpers.js';

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

const ok = { text: 'ran', structured: {} };
const seen: OpContext[] = [];
const handler = vi.fn(async (ctx: OpContext) => {
  seen.push(ctx);
  return ok;
});
const handlers = Object.fromEntries(tools.map((t) => [t.name, handler]));

const agent: OpAgent = { id: 'a', ownerUserId: 'u', headless: false };
const player = { id: 'u', isGM: false };
const gm = { id: 'g', isGM: true };

function setup() {
  stub = installFoundry(14, { persistedWorldSettings: true });
  (globalThis as any).game.user = { id: 'gm', isGM: true };
  (globalThis as any).game.i18n = englishI18n;
  registerPolicySettings();
  handler.mockClear();
  seen.length = 0;
  lastApproval = undefined;
  return createDispatcher({
    tools,
    handlers,
    stages: [
      createPolicyStage({ tools }),
      {
        name: 'record',
        order: 30,
        run: async (ctx, next) => ((lastApproval = ctx.approval?.approver), next()),
      },
    ],
  });
}
const run = (
  d: ReturnType<typeof setup>,
  category: ToolCategory,
  user = player,
  a: OpAgent = agent,
  args: unknown = { id: 'x' },
) => d({ tool: `${category}_thing`, args, agent: a, sessionId: 's' }, user);

describe('policy stage', () => {
  it('is registered in the live pipeline at order 20, once, and alone at that order', () => {
    expect(STAGES.filter((s) => s.order === 20)).toEqual([policyStage]);
    expect(policyStage.order).toBe(20);
    expect(STAGES.filter((s) => s.name === 'policy')).toHaveLength(1);
  });

  it('allow continues to the handler', async () => {
    const d = setup();
    await setSetting('playerAgentsEnabled', true);
    expect(await run(d, 'read')).toEqual(ok);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(seen[0]!.approval).toBeUndefined();
  });

  it('a GM agent reads by default with player agents still disabled', async () => {
    const d = setup();
    await setSetting('playerAgentsEnabled', false);
    expect(await run(d, 'read', gm)).toEqual(ok);
  });

  it('deny returns DENIED with the localized reason and never runs the handler', async () => {
    const d = setup();
    await setSetting('playerAgentsEnabled', true);
    const m: PolicyMatrix = structuredClone(DEFAULT_WORLD_MATRIX);
    m.playerAgents.read = 'deny';
    await saveWorldPolicy(m);
    const r = await run(d, 'read');
    expect(r).toEqual({
      error: { code: 'DENIED', message: 'The policy denies read tools for this agent.' },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    ['write', player, 'owner'],
    ['destructive', player, 'gm'],
    ['code', player, 'gm'],
    ['write', gm, 'owner'],
    ['destructive', gm, 'owner'],
    ['code', gm, 'owner'],
  ] as const)(
    '%s by %o asks the %s: sets ctx.approval and continues; without an approval stage the dispatcher refuses',
    async (category, user, approver) => {
      setup();
      await setSetting('playerAgentsEnabled', true);
      const probe: OpContext[] = [];
      const dd = createDispatcher({
        tools,
        handlers,
        stages: [
          createPolicyStage({ tools }),
          { name: 'probe', order: 30, run: async (ctx, next) => (probe.push(ctx), next()) },
        ],
      });
      const r = await run(dd, category, user);
      expect(r).toMatchObject({ error: { code: 'DENIED' } });
      expect((r as any).error.message).toMatch(/^Approval is required for /);
      expect(handler).not.toHaveBeenCalled();
      expect(probe).toHaveLength(1);
      expect(probe[0]!.approval).toEqual({ approver });
    },
  );

  it('sets ctx.approval to the approver for an ask decision', async () => {
    setup();
    await setSetting('playerAgentsEnabled', true);
    const ctxs: OpContext[] = [];
    const earlier = {
      name: 'capture',
      order: 10,
      run: async (ctx: OpContext, next: () => Promise<any>) => {
        ctxs.push(ctx);
        return next();
      },
    };
    const d = createDispatcher({
      tools,
      handlers,
      stages: [earlier, createPolicyStage({ tools })],
    });
    await run(d, 'write');
    expect(ctxs[0]!.approval).toEqual({ approver: 'owner' });
    await run(d, 'destructive');
    expect(ctxs[1]!.approval).toEqual({ approver: 'gm' });
    await run(d, 'read');
    expect(ctxs[2]!.approval).toBeUndefined();
  });

  it('validation runs first: an invalid call is INVALID_ARGS even when the policy would deny', async () => {
    const d = setup();
    await setSetting('playerAgentsEnabled', false);
    const r = await run(d, 'read', player, agent, { nope: 1 });
    expect(r).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('an unknown category denies (fail closed)', async () => {
    setup();
    await setSetting('playerAgentsEnabled', true);
    const odd = { ...tool('read'), name: 'odd_thing', category: 'mystery' } as any;
    const d = createDispatcher({
      tools: [odd],
      handlers: { odd_thing: handler },
      stages: [createPolicyStage({ tools: [odd] })],
    });
    const r = await d({ tool: 'odd_thing', args: { id: 'x' }, agent, sessionId: 's' }, player);
    expect(r).toMatchObject({ error: { code: 'DENIED' } });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('enable toggles', () => {
  it('player agents off: a non-GM is DENIED naming the setting, even for read', async () => {
    const d = setup();
    await setSetting('playerAgentsEnabled', false);
    const r = await run(d, 'read');
    expect(r).toEqual({
      error: {
        code: 'DENIED',
        message:
          'Player agents are turned off in this world. A GM must turn on "Enable player agents" in the Agent Gateway settings.',
      },
    });
    expect(handler).not.toHaveBeenCalled();
    await setSetting('playerAgentsEnabled', true);
    expect(await run(d, 'read')).toEqual(ok);
  });

  it('the default for player agents is off in a world that never set it', async () => {
    const d = setup();
    await setSetting('playerAgentsEnabled', undefined);
    const stubSettings = (globalThis as any).game.settings;
    // An unset value falls back to the registered default, which is false.
    expect(stubSettings.get('agent-gateway', 'playerAgentsEnabled')).toBe(false);
    expect(await run(d, 'read')).toMatchObject({ error: { code: 'DENIED' } });
  });

  it('headless off: DENIED naming the setting, for a GM too; on: continues', async () => {
    const d = setup();
    await setSetting('playerAgentsEnabled', true);
    const headless = { ...agent, headless: true };
    for (const u of [player, gm]) {
      const r = await run(d, 'read', u, headless);
      expect(r).toEqual({
        error: {
          code: 'DENIED',
          message:
            'Headless agents are turned off in this world. A GM must turn on "Enable headless agents" in the Agent Gateway settings.',
        },
      });
    }
    expect(handler).not.toHaveBeenCalled();
    await setSetting('headlessAgentsEnabled', true);
    expect(await run(d, 'read', player, headless)).toEqual(ok);
    expect(await run(d, 'read', gm, headless)).toEqual(ok);
  });

  it('a non-headless agent is unaffected by the headless toggle', async () => {
    const d = setup();
    await setSetting('playerAgentsEnabled', true);
    await setSetting('headlessAgentsEnabled', false);
    expect(await run(d, 'read', gm)).toEqual(ok);
  });
});

/** Which approver the policy asked for, read off ctx.approval by a stage placed after it. */
async function asked(d: ReturnType<typeof setup>, category: ToolCategory, user = player) {
  const r = (await run(d, category, user)) as any;
  expect(r).toMatchObject({ error: { code: 'DENIED' } });
  return lastApproval;
}
let lastApproval: string | undefined;

describe('owner policy against the world ceiling', () => {
  const m = (patch: (x: PolicyMatrix) => void): PolicyMatrix => {
    const x = structuredClone(DEFAULT_WORLD_MATRIX);
    patch(x);
    return x;
  };

  it('an owner policy can tighten', async () => {
    const d = setup();
    await setSetting('playerAgentsEnabled', true);
    await saveOwnerPolicy(m((x) => (x.playerAgents.read = 'deny')));
    expect(await run(d, 'read')).toMatchObject({ error: { code: 'DENIED' } });
    expect(liveInputs().owner.playerAgents.read).toBe('deny');
  });

  it('an owner policy cannot loosen: a client that edits its own setting stays under the ceiling', async () => {
    const d = setup();
    await setSetting('playerAgentsEnabled', true);
    await saveWorldPolicy(m((x) => (x.playerAgents.write = 'deny')));
    // Bypass the validated save and write the loosest possible value straight into storage.
    const loose = Object.fromEntries(
      ['playerAgents', 'gmAgents'].map((c) => [
        c,
        { read: 'allow', write: 'allow', destructive: 'allow', code: 'allow' },
      ]),
    );
    await setSetting('ownerPolicy', JSON.stringify(loose));
    expect(await run(d, 'write')).toMatchObject({
      error: { code: 'DENIED', message: expect.stringContaining('denies write') },
    });
    // Destructive stays at the world's ask_gm, code stays an ask.
    await saveWorldPolicy(DEFAULT_WORLD_MATRIX);
    expect(await asked(d, 'destructive')).toBe('gm');
    expect(await asked(d, 'code')).toBe('gm');
  });

  it('a tighter owner value wins over a looser world value', async () => {
    const d = setup();
    await setSetting('playerAgentsEnabled', true);
    await saveWorldPolicy(m((x) => (x.playerAgents.write = 'ask_owner')));
    await saveOwnerPolicy(m((x) => (x.playerAgents.write = 'ask_gm')));
    expect(await asked(d, 'write')).toBe('gm');
  });

  it('a world policy of allow for code still asks', async () => {
    const d = setup();
    await setSetting('playerAgentsEnabled', true);
    await setSetting('worldPolicy', JSON.stringify(m((x) => (x.gmAgents.code = 'allow'))));
    expect(await asked(d, 'code', gm)).toBe('owner');
    expect(handler).not.toHaveBeenCalled();
  });

  it('the world ceiling for a GM-class and a player-class call are separate', async () => {
    const d = setup();
    await setSetting('playerAgentsEnabled', true);
    await saveWorldPolicy(m((x) => (x.playerAgents.write = 'allow')));
    expect(await run(d, 'write', player)).toEqual(ok);
    expect(await asked(d, 'write', gm)).toBe('owner');
  });
});
