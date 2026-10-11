/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OWNER_MATRIX,
  DEFAULT_WORLD_MATRIX,
  DENY_ALL_MATRIX,
} from '../../../src/policy/matrix.js';
import { createPolicyStage } from '../../../src/policy/stage.js';
import { evaluate } from '../../../src/policy/evaluate.js';
import {
  loadWorldPolicy,
  loadOwnerPolicy,
  playerAgentsEnabled,
  headlessAgentsEnabled,
} from '../../../src/policy/store.js';
import { DEFAULT_LIMITS, resolveLimit } from '../../../src/ratelimit/config.js';
import { loadRateLimits } from '../../../src/ratelimit/store.js';
import {
  policyContext,
  validatePolicyForm,
  type PolicyState,
} from '../../../src/apps/policy/model.js';
import {
  currentPolicyState,
  createPolicyApp,
  registerPolicyMenu,
  savePolicyForm,
} from '../../../src/apps/policy/index.js';
import { installFoundry, type FoundryStub } from '../../stubs/foundry.js';

const state = (isGM = false): PolicyState => ({
  isGM,
  world: structuredClone(DEFAULT_WORLD_MATRIX),
  owner: structuredClone(DEFAULT_OWNER_MATRIX),
  playerEnabled: false,
  headlessEnabled: false,
  folders: [{ id: 'folder', name: '<script>folder</script>' }],
  allowlists: { playerAgents: [], gmAgents: [] },
  limits: structuredClone(DEFAULT_LIMITS),
  agentsCorrupt: false,
});
function values(s: PolicyState) {
  const context = policyContext(s);
  const out: Record<string, unknown> = {};
  for (const row of context.ownerRows) for (const cell of row.cells) out[cell.name] = cell.value;
  if (s.isGM) {
    for (const row of context.worldRows) for (const cell of row.cells) out[cell.name] = cell.value;
    for (const row of context.classes) {
      out[row.folderName] = [];
      for (const bucket of row.buckets) out[bucket.name] = bucket.value;
    }
    out.playerEnabled = s.playerEnabled;
    out.headlessEnabled = s.headlessEnabled;
  }
  return out;
}

describe('policy template context', () => {
  it.each([false, true])('prepares the %s GM view with ceiling-aware owner options', (isGM) => {
    const context = policyContext(state(isGM));
    expect(context.isGM).toBe(isGM);
    const cells = context.ownerRows.flatMap((row) => row.cells);
    const write = cells.find((c) => c.name === 'owner_playerAgents_write')!;
    expect(write.options.find((o) => o.value === 'allow')).toMatchObject({
      disabled: true,
      selected: false,
    });
    expect(write.options.find((o) => o.value === 'ask_owner')).toMatchObject({
      disabled: false,
      selected: true,
    });
    expect(
      cells
        .filter((c) => c.name.endsWith('_code'))
        .every((c) => c.options.every((o) => o.value !== 'allow')),
    ).toBe(true);
    expect(
      context.worldRows
        .flatMap((r) => r.cells)
        .filter((c) => c.name.endsWith('_code'))
        .every((c) => c.options.every((o) => o.value !== 'allow')),
    ).toBe(true);
  });
  it('keeps missing allowed folder ids selected rather than silently allowing all folders', () => {
    const s = state(true);
    s.allowlists.playerAgents = ['removed'];
    expect(policyContext(s).classes[0]!.folders).toContainEqual({
      id: 'removed',
      name: 'removed',
      selected: true,
    });
  });
  it('rejects a forged owner option looser than a freshly tightened ceiling', () => {
    const s = state();
    const submitted = values(s);
    s.world.playerAgents.read = 'deny';
    expect(() => validatePolicyForm(submitted, s)).toThrow('owner exceeds ceiling');
  });
  it('preserves per-agent limits while changing defaults', () => {
    const s = state(true);
    s.limits.agents = { agent: { read: 9 } };
    const result = validatePolicyForm({ ...values(s), limits_playerAgents_read: '123' }, s);
    expect(result.limits?.agents).toEqual({ agent: { read: 9 } });
    expect(result.limits?.playerAgents.read).toBe(123);
  });
});

let stub: FoundryStub;
let set: ReturnType<typeof vi.spyOn>;
let persist: (ns: string, key: string, value: unknown) => Promise<void>;
let error: ReturnType<typeof vi.fn>;
beforeEach(() => {
  stub = installFoundry(14);
  const g = globalThis as any;
  g.game.user = { id: 'gm', isGM: true };
  g.game.folders = { contents: [{ id: 'folder', name: 'Folder' }] };
  g.game.i18n = { localize: (key: string) => 'L:' + key };
  error = vi.fn();
  g.ui = { notifications: { error, info: vi.fn() } };
  g.game.settings.register('agent-gateway', 'worldPolicy', {
    default: JSON.stringify(DEFAULT_WORLD_MATRIX),
  });
  g.game.settings.register('agent-gateway', 'ownerPolicy', {
    default: JSON.stringify(DEFAULT_OWNER_MATRIX),
  });
  g.game.settings.register('agent-gateway', 'rateLimits', {
    default: JSON.stringify(DEFAULT_LIMITS),
  });
  persist = g.game.settings.set;
  set = vi.spyOn(g.game.settings, 'set');
});
afterEach(() => {
  vi.restoreAllMocks();
  stub.uninstall();
});

it('registers an unrestricted ApplicationV2 menu and prepares its GM/player contexts', async () => {
  registerPolicyMenu();
  expect(stub.registeredMenus.get('agent-gateway.policy').restricted).toBe(false);
  const App = createPolicyApp();
  const app = new App();
  expect((await app._prepareContext()).isGM).toBe(true);
  (globalThis as any).game.user.isGM = false;
  expect((await app._prepareContext()).isGM).toBe(false);
  expect(App.PARTS.form.template).toContain('templates/policy/policy.hbs');
});

it('saves all GM controls through registered policy and limit settings', async () => {
  const form = {
    ...values(currentPolicyState()),
    playerEnabled: true,
    folders_playerAgents: ['folder'],
    limits_playerAgents_write: 22,
  };
  expect(await savePolicyForm(form)).toBe(true);
  expect(set.mock.calls.map((call) => call[1])).toEqual([
    'worldPolicy',
    'playerAgentsEnabled',
    'headlessAgentsEnabled',
    'folderAllowlist',
    'rateLimits',
    'ownerPolicy',
    'playerAgentsEnabled',
    'worldPolicy',
  ]);
  expect(
    JSON.parse(set.mock.calls.find((call) => call[1] === 'folderAllowlist')![2] as string)
      .playerAgents,
  ).toEqual(['folder']);
});

it('rejects an unrelated GM save without relaxing a corrupt per-agent limit block', async () => {
  const settings = (globalThis as any).game.settings;
  const raw = JSON.stringify({ ...DEFAULT_LIMITS, agents: 'damaged' });
  await persist('agent-gateway', 'rateLimits', raw);
  await persist('agent-gateway', 'playerAgentsEnabled', true);
  await persist('agent-gateway', 'headlessAgentsEnabled', true);
  const before = loadRateLimits();
  expect(before.agentsCorrupt).toBe(true);
  expect(resolveLimit(before, 'playerAgents', 'agent', 'read')).toBe(1);
  const owner = settings.get('agent-gateway', 'ownerPolicy');
  const form = { ...values(currentPolicyState()), owner_playerAgents_read: 'deny' };
  const saved = await savePolicyForm(form);
  expect(resolveLimit(loadRateLimits(), 'playerAgents', 'agent', 'read')).toBe(1);
  expect(saved).toBe(false);
  expect(set).not.toHaveBeenCalled();
  expect(settings.get('agent-gateway', 'rateLimits')).toBe(raw);
  expect(settings.get('agent-gateway', 'playerAgentsEnabled')).toBe(true);
  expect(settings.get('agent-gateway', 'headlessAgentsEnabled')).toBe(true);
  expect(settings.get('agent-gateway', 'ownerPolicy')).toBe(owner);
  expect(loadRateLimits().agentsCorrupt).toBe(true);
  expect(resolveLimit(loadRateLimits(), 'playerAgents', 'agent', 'read')).toBe(1);
  expect(error).toHaveBeenCalledWith('L:AGENT_GATEWAY.PolicyApp.invalid');
});

it('re-reads corrupt overrides at submit after the form was opened with valid limits', async () => {
  const form = { ...values(currentPolicyState()), owner_playerAgents_read: 'deny' };
  expect(loadRateLimits().agentsCorrupt).toBe(false);
  const raw = JSON.stringify({ ...DEFAULT_LIMITS, agents: 'damaged' });
  await persist('agent-gateway', 'rateLimits', raw);
  expect(await savePolicyForm(form)).toBe(false);
  expect(set).not.toHaveBeenCalled();
  expect((globalThis as any).game.settings.get('agent-gateway', 'rateLimits')).toBe(raw);
  expect(resolveLimit(loadRateLimits(), 'playerAgents', 'agent', 'read')).toBe(1);
});

it('allows player owner-only restrictions while leaving corrupt world overrides untouched', async () => {
  const g = globalThis as any;
  const raw = JSON.stringify({ ...DEFAULT_LIMITS, agents: 'damaged' });
  await persist('agent-gateway', 'rateLimits', raw);
  g.game.user.isGM = false;
  expect(
    await savePolicyForm({ ...values(currentPolicyState()), owner_playerAgents_read: 'deny' }),
  ).toBe(true);
  expect(set.mock.calls.map((call) => call[1])).toEqual(['ownerPolicy']);
  expect(g.game.settings.get('agent-gateway', 'rateLimits')).toBe(raw);
  expect(resolveLimit(loadRateLimits(), 'playerAgents', 'agent', 'read')).toBe(1);
});

it('preserves actual per-agent overrides and special IDs while saving class defaults', async () => {
  const agents = JSON.parse('{"agent":{"read":9},"__proto__":{"write":3}}');
  await persist('agent-gateway', 'rateLimits', JSON.stringify({ ...DEFAULT_LIMITS, agents }));
  expect(
    await savePolicyForm({ ...values(currentPolicyState()), limits_playerAgents_read: 123 }),
  ).toBe(true);
  const loaded = loadRateLimits();
  expect(loaded.agentsCorrupt).toBe(false);
  expect(Object.fromEntries(loaded.agents)).toEqual(agents);
  expect(resolveLimit(loaded, 'playerAgents', 'agent', 'read')).toBe(9);
  expect(resolveLimit(loaded, 'playerAgents', '__proto__', 'write')).toBe(3);
  expect(resolveLimit(loaded, 'playerAgents', 'other', 'read')).toBe(123);
});

it.each([
  { world_playerAgents_code: 'allow' },
  { limits_playerAgents_read: 0 },
  { limits_playerAgents_read: '1.5' },
  { limits_playerAgents_read: '' },
  { folders_playerAgents: ['unknown'] },
  { playerEnabled: 'true' },
])('rejects invalid input without any writes: %j', async (patch) => {
  expect(await savePolicyForm({ ...values(currentPolicyState()), ...patch })).toBe(false);
  expect(set).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith('L:AGENT_GATEWAY.PolicyApp.invalid');
});

it('saves only owner policy for a player and refuses forged world fields', async () => {
  (globalThis as any).game.user.isGM = false;
  const form = values(currentPolicyState());
  expect(await savePolicyForm(form)).toBe(true);
  expect(set.mock.calls.map((call) => call[1])).toEqual(['ownerPolicy']);
  set.mockClear();
  expect(await savePolicyForm({ ...form, playerEnabled: true })).toBe(false);
  expect(set).not.toHaveBeenCalled();
});

it('rejects a stale GM form when the user is no longer GM', async () => {
  const form = values(currentPolicyState());
  (globalThis as any).game.user.isGM = false;
  expect(await savePolicyForm(form)).toBe(false);
  expect(set).not.toHaveBeenCalled();
});

it('quiesces already-enabled access until every restriction and owner policy has persisted', async () => {
  const settings = (globalThis as any).game.settings;
  await persist('agent-gateway', 'playerAgentsEnabled', true);
  await persist('agent-gateway', 'headlessAgentsEnabled', true);
  const form = {
    ...values(currentPolicyState()),
    folders_playerAgents: ['folder'],
    limits_playerAgents_write: 22,
    owner_playerAgents_read: 'deny',
  };
  let release!: () => void;
  const waiting = new Promise<void>((done) => {
    release = done;
  });
  set.mockImplementation(async (ns: string, key: string, value: unknown) => {
    if (key === 'folderAllowlist') await waiting;
    if (value === true) {
      expect(JSON.parse(settings.get(ns, 'folderAllowlist')).playerAgents).toEqual(['folder']);
      expect(JSON.parse(settings.get(ns, 'rateLimits')).playerAgents.write).toBe(22);
      expect(JSON.parse(settings.get(ns, 'ownerPolicy')).playerAgents.read).toBe('deny');
    }
    await persist(ns, key, value);
  });
  const saved = savePolicyForm(form);
  await vi.waitFor(() =>
    expect(set).toHaveBeenCalledWith('agent-gateway', 'folderAllowlist', expect.any(String)),
  );
  expect(settings.get('agent-gateway', 'playerAgentsEnabled')).toBe(false);
  expect(settings.get('agent-gateway', 'headlessAgentsEnabled')).toBe(false);
  release();
  expect(await saved).toBe(true);
  expect(settings.get('agent-gateway', 'playerAgentsEnabled')).toBe(true);
  expect(settings.get('agent-gateway', 'headlessAgentsEnabled')).toBe(true);
});

it.each(['worldPolicy', 'folderAllowlist', 'rateLimits', 'ownerPolicy'])(
  'does not enable either class when persisting %s fails',
  async (failedKey) => {
    const settings = (globalThis as any).game.settings;
    set.mockImplementation(async (ns: string, key: string, value: unknown) => {
      if (key === failedKey) throw new Error('Settings unavailable');
      await persist(ns, key, value);
    });
    expect(
      await savePolicyForm({
        ...values(currentPolicyState()),
        playerEnabled: true,
        headlessEnabled: true,
      }),
    ).toBe(false);
    expect(set.mock.calls.some((call) => call[2] === true)).toBe(false);
    if (failedKey !== 'worldPolicy')
      expect(interactiveGMRead()).toMatchObject({ kind: 'decision', decision: 'deny' });
    expect(settings.get('agent-gateway', 'playerAgentsEnabled')).toBe(false);
    expect(settings.get('agent-gateway', 'headlessAgentsEnabled')).toBe(false);
  },
);

it.each(['playerAgentsEnabled', 'headlessAgentsEnabled'])(
  'closes both gates when enabling %s applies then rejects',
  async (failedKey) => {
    const settings = (globalThis as any).game.settings;
    set.mockImplementation(async (ns: string, key: string, value: unknown) => {
      await persist(ns, key, value);
      if (key === failedKey && value === true) throw new Error('Enable acknowledgement failed');
    });
    expect(
      await savePolicyForm({
        ...values(currentPolicyState()),
        playerEnabled: true,
        headlessEnabled: true,
      }),
    ).toBe(false);
    expect(settings.get('agent-gateway', 'playerAgentsEnabled')).toBe(false);
    expect(settings.get('agent-gateway', 'headlessAgentsEnabled')).toBe(false);
    expect(set.mock.calls.slice(-2).map((call) => [call[1], call[2]])).toEqual([
      ['playerAgentsEnabled', false],
      ['headlessAgentsEnabled', false],
    ]);
    if (failedKey === 'headlessAgentsEnabled')
      expect(set).toHaveBeenCalledWith('agent-gateway', 'playerAgentsEnabled', true);
  },
);

it('aborts restriction writes if quiescing fails and still attempts the other gate', async () => {
  const settings = (globalThis as any).game.settings;
  await persist('agent-gateway', 'playerAgentsEnabled', true);
  await persist('agent-gateway', 'headlessAgentsEnabled', true);
  set.mockImplementation(async (ns: string, key: string, value: unknown) => {
    if (key === 'playerAgentsEnabled') throw new Error('Backend refuses disable');
    await persist(ns, key, value);
  });
  expect(
    await savePolicyForm({
      ...values(currentPolicyState()),
      playerEnabled: false,
      headlessEnabled: false,
    }),
  ).toBe(false);
  expect(
    set.mock.calls.every((call) =>
      ['worldPolicy', 'playerAgentsEnabled', 'headlessAgentsEnabled'].includes(call[1]),
    ),
  ).toBe(true);
  expect(settings.get('agent-gateway', 'headlessAgentsEnabled')).toBe(false);
  // The failed backend cannot be made transactional: preserve/report failure rather than enabling.
  expect(settings.get('agent-gateway', 'playerAgentsEnabled')).toBe(true);
  expect(error).toHaveBeenCalledWith('L:AGENT_GATEWAY.PolicyApp.invalid');
});

// Read current persisted settings as another interactive GM's resolver does.
function interactiveGMRead() {
  return evaluate(
    {
      world: loadWorldPolicy(),
      owner: loadOwnerPolicy(),
      playerAgentsEnabled: playerAgentsEnabled(),
      headlessAgentsEnabled: headlessAgentsEnabled(),
    },
    { isGM: true, headless: false, category: 'read' },
  );
}

it('denies interactive GM reads while a newly restrictive folder write is pending', async () => {
  await persist('agent-gateway', 'worldPolicy', JSON.stringify(DENY_ALL_MATRIX));
  const form = {
    ...values(currentPolicyState()),
    world_gmAgents_read: 'allow',
    owner_gmAgents_read: 'allow',
    folders_gmAgents: ['folder'],
  };
  let release!: () => void;
  const waiting = new Promise<void>((done) => {
    release = done;
  });
  set.mockImplementation(async (ns: string, key: string, value: unknown) => {
    if (key === 'folderAllowlist') await waiting;
    await persist(ns, key, value);
  });
  const saved = savePolicyForm(form);
  await vi.waitFor(() =>
    expect(set).toHaveBeenCalledWith('agent-gateway', 'folderAllowlist', expect.any(String)),
  );
  expect(interactiveGMRead()).toMatchObject({ kind: 'decision', decision: 'deny' });
  const next = vi.fn();
  const stage = createPolicyStage({ tools: [{ name: 'world_info', category: 'read' }] as any });
  expect(
    await stage.run(
      { tool: 'world_info', user: { isGM: true }, agent: { headless: false } } as any,
      next,
    ),
  ).toMatchObject({ error: { code: 'DENIED' } });
  expect(next).not.toHaveBeenCalled();
  release();
  expect(await saved).toBe(true);
  expect(interactiveGMRead()).toMatchObject({ kind: 'decision', decision: 'allow' });
  expect(set.mock.calls.at(-1)?.[1]).toBe('worldPolicy');
  expect(
    JSON.parse((globalThis as any).game.settings.get('agent-gateway', 'folderAllowlist')).gmAgents,
  ).toEqual(['folder']);
});

it('retains interactive GM denial when the restrictive folder write fails', async () => {
  const form = {
    ...values(currentPolicyState()),
    world_gmAgents_read: 'allow',
    owner_gmAgents_read: 'allow',
    folders_gmAgents: ['folder'],
  };
  set.mockImplementation(async (ns: string, key: string, value: unknown) => {
    if (key === 'folderAllowlist') throw new Error('Folder write failed');
    await persist(ns, key, value);
  });
  expect(await savePolicyForm(form)).toBe(false);
  expect(interactiveGMRead()).toMatchObject({ kind: 'decision', decision: 'deny' });
  expect(loadWorldPolicy()).toEqual(DENY_ALL_MATRIX);
});

it('restores world denial when the final requested matrix applies then rejects', async () => {
  const form = {
    ...values(currentPolicyState()),
    playerEnabled: true,
    headlessEnabled: true,
    world_gmAgents_read: 'allow',
    owner_gmAgents_read: 'allow',
    folders_gmAgents: ['folder'],
  };
  set.mockImplementation(async (ns: string, key: string, value: unknown) => {
    await persist(ns, key, value);
    if (key === 'worldPolicy' && JSON.parse(String(value)).gmAgents.read === 'allow')
      throw new Error('Final matrix acknowledgement failed');
  });
  expect(await savePolicyForm(form)).toBe(false);
  expect(interactiveGMRead()).toMatchObject({ kind: 'decision', decision: 'deny' });
  expect(loadWorldPolicy()).toEqual(DENY_ALL_MATRIX);
  expect(playerAgentsEnabled()).toBe(false);
  expect(headlessAgentsEnabled()).toBe(false);
});

it('aborts restriction changes if the initial world denial cannot be persisted', async () => {
  set.mockImplementation(async (ns: string, key: string, value: unknown) => {
    if (key === 'worldPolicy') throw new Error('Backend refuses world denial');
    await persist(ns, key, value);
  });
  expect(
    await savePolicyForm({ ...values(currentPolicyState()), folders_gmAgents: ['folder'] }),
  ).toBe(false);
  expect(
    set.mock.calls.some((call) =>
      ['folderAllowlist', 'rateLimits', 'ownerPolicy'].includes(call[1]),
    ),
  ).toBe(false);
  expect(playerAgentsEnabled()).toBe(false);
  expect(headlessAgentsEnabled()).toBe(false);
  // Persisted denial cannot be guaranteed when the backend rejects every world write.
  expect(loadWorldPolicy()).toEqual(DEFAULT_WORLD_MATRIX);
});
