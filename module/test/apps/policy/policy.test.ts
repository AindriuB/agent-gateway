/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OWNER_MATRIX, DEFAULT_WORLD_MATRIX } from '../../../src/policy/matrix.js';
import { DEFAULT_LIMITS } from '../../../src/ratelimit/config.js';
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
  ]);
  expect(
    JSON.parse(set.mock.calls.find((call) => call[1] === 'folderAllowlist')![2] as string)
      .playerAgents,
  ).toEqual(['folder']);
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
