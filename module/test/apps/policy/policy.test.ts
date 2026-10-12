// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OWNER_MATRIX,
  DEFAULT_WORLD_MATRIX,
  DENY_ALL_MATRIX,
} from '../../../src/policy/matrix.js';
import { loadWorldPolicy, loadOwnerPolicy } from '../../../src/policy/store.js';
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
  stub = installFoundry(14, { persistedWorldSettings: true });
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
    'ownerPolicy',
    'worldPolicySnapshotMigrated',
    'worldPolicy',
  ]);
  expect(JSON.parse(set.mock.calls.at(-1)![2] as string).folders.playerAgents).toEqual(['folder']);
  expect(loadRateLimits().classes.playerAgents.write).toBe(22);
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

it('keeps the previous complete proposal while owner persistence waits', async () => {
  const before = currentPolicyState();
  let release!: () => void;
  const waiting = new Promise<void>((done) => {
    release = done;
  });
  set.mockImplementation(async (ns, key, value) => {
    if (key === 'ownerPolicy') await waiting;
    await persist(ns, key, value);
  });
  const saved = savePolicyForm({ ...values(before), folders_playerAgents: ['folder'] });
  await vi.waitFor(() =>
    expect(set).toHaveBeenCalledWith('agent-gateway', 'ownerPolicy', expect.any(String)),
  );
  expect(currentPolicyState().allowlists).toEqual(before.allowlists);
  expect(set.mock.calls.map((call) => call[1])).toEqual(['ownerPolicy']);
  release();
  expect(await saved).toBe(true);
  expect(currentPolicyState().allowlists.playerAgents).toEqual(['folder']);
});

it.each(['ownerPolicy', 'worldPolicySnapshotMigrated', 'worldPolicy'])(
  'reports %s failure without compensating writes',
  async (failed) => {
    set.mockImplementation(async (ns, key, value) => {
      if (key === failed) throw Error('Unavailable');
      await persist(ns, key, value);
    });
    expect(await savePolicyForm({ ...values(currentPolicyState()), playerEnabled: true })).toBe(
      false,
    );
    expect(set.mock.calls.filter((call) => call[1] === failed)).toHaveLength(1);
    expect(
      set.mock.calls.some((call) =>
        ['folderAllowlist', 'rateLimits', 'playerAgentsEnabled', 'headlessAgentsEnabled'].includes(
          call[1],
        ),
      ),
    ).toBe(false);
    if (failed === 'ownerPolicy') expect(set.mock.calls).toHaveLength(1);
    expect(error).toHaveBeenCalled();
  },
);

it('keeps a complete applied proposal when its acknowledgement fails', async () => {
  set.mockImplementation(async (ns, key, value) => {
    await persist(ns, key, value);
    if (key === 'worldPolicy') throw Error('Acknowledgement failed');
  });
  expect(
    await savePolicyForm({
      ...values(currentPolicyState()),
      folders_gmAgents: ['folder'],
      limits_gmAgents_read: 17,
    }),
  ).toBe(false);
  expect(currentPolicyState().allowlists.gmAgents).toEqual(['folder']);
  expect(loadRateLimits().classes.gmAgents.read).toBe(17);
  expect(set.mock.calls.map((call) => call[1])).toEqual([
    'ownerPolicy',
    'worldPolicySnapshotMigrated',
    'worldPolicy',
  ]);
});

it('refuses world publication after losing GM during owner persistence', async () => {
  set.mockImplementation(async (ns, key, value) => {
    await persist(ns, key, value);
    if (key === 'ownerPolicy') (globalThis as any).game.user.isGM = false;
  });
  expect(await savePolicyForm(values(currentPolicyState()))).toBe(false);
  expect(set.mock.calls.map((call) => call[1])).toEqual(['ownerPolicy']);
});

// Render context-backed native form controls, then exercise the real Application lifecycle.
async function renderedPolicyForm() {
  const App = createPolicyApp();
  const app = new App();
  const context = await app._prepareContext();
  const form = document.createElement('form');
  for (const row of [...(context.isGM ? context.worldRows : []), ...context.ownerRows])
    for (const cell of row.cells) {
      const select = document.createElement('select');
      select.name = cell.name;
      for (const item of cell.options) {
        const option = document.createElement('option');
        option.value = item.value;
        option.selected = item.selected;
        option.disabled = item.disabled;
        select.append(option);
      }
      form.append(select);
    }
  app.element = form;
  app.render = vi.fn();
  await app._onRender(context, {});
  await app._onRender(context, {});
  const submit = async () => {
    const data = values(currentPolicyState());
    for (const select of form.querySelectorAll('select')) data[select.name] = select.value;
    await App.onSubmit.call(app, new Event('submit'), form, { object: data });
  };
  return { form, app, submit };
}

it('enables relaxed draft owner options and saves both choices in one native form submission', async () => {
  await persist('agent-gateway', 'worldPolicy', JSON.stringify(DENY_ALL_MATRIX));
  const { form, app, submit } = await renderedPolicyForm();
  const world = form.querySelector<HTMLSelectElement>('[name="world_gmAgents_read"]')!;
  const owner = form.querySelector<HTMLSelectElement>('[name="owner_gmAgents_read"]')!;
  expect(owner.querySelector<HTMLOptionElement>('[value="allow"]')!.disabled).toBe(true);
  const other = form.querySelector<HTMLSelectElement>('[name="owner_playerAgents_read"]')!;
  const otherBefore = other.value;
  world.value = 'allow';
  world.dispatchEvent(new Event('change', { bubbles: true }));
  expect(owner.querySelector<HTMLOptionElement>('[value="allow"]')!.disabled).toBe(false);
  expect(other.value).toBe(otherBefore);
  expect(owner.value).toBe('deny'); // A stricter existing choice stays selected.
  owner.value = 'allow';
  expect(set).not.toHaveBeenCalled();
  await submit();
  expect(loadWorldPolicy().gmAgents.read).toBe('allow');
  expect(loadOwnerPolicy().gmAgents.read).toBe('allow');
  expect(app.render).toHaveBeenCalledOnce();
});

it('clamps a weaker owner choice when the draft ceiling tightens and saves once', async () => {
  const { form, app, submit } = await renderedPolicyForm();
  const world = form.querySelector<HTMLSelectElement>('[name="world_gmAgents_read"]')!;
  const owner = form.querySelector<HTMLSelectElement>('[name="owner_gmAgents_read"]')!;
  expect(owner.value).toBe('allow');
  world.value = 'ask_gm';
  world.dispatchEvent(new Event('change', { bubbles: true }));
  expect(owner.value).toBe('ask_gm');
  expect(owner.querySelector<HTMLOptionElement>('[value="allow"]')!.disabled).toBe(true);
  expect(owner.querySelector<HTMLOptionElement>('[value="ask_owner"]')!.disabled).toBe(true);
  owner.value = 'deny';
  world.value = 'ask_owner';
  world.dispatchEvent(new Event('change', { bubbles: true }));
  expect(owner.value).toBe('deny');
  expect(set).not.toHaveBeenCalled();
  await submit();
  expect(loadWorldPolicy().gmAgents.read).toBe('ask_owner');
  expect(loadOwnerPolicy().gmAgents.read).toBe('deny');
  expect(app.render).toHaveBeenCalledOnce();
});

it('keeps player ceilings immutable and ignores GM draft handlers after role loss', async () => {
  const { form } = await renderedPolicyForm();
  const world = form.querySelector<HTMLSelectElement>('[name="world_gmAgents_read"]')!;
  const owner = form.querySelector<HTMLSelectElement>('[name="owner_gmAgents_read"]')!;
  (globalThis as any).game.user.isGM = false;
  world.value = 'deny';
  world.dispatchEvent(new Event('change', { bubbles: true }));
  expect(owner.value).toBe('allow');
  const player = await renderedPolicyForm();
  expect(player.form.querySelector('[name^="world_"]')).toBeNull();
  expect(
    [...player.form.querySelectorAll('select')].every((s) => s.name.startsWith('owner_')),
  ).toBe(true);
  expect(set).not.toHaveBeenCalled();
});

it('wires offline controls only for GM and rechecks authority at click time', async () => {
  const g = globalThis as any;
  const App = createPolicyApp();
  const app = new App();
  const context = await app._prepareContext();
  expect(context.offlineEvents).toEqual({ enabled: false, retentionDays: 14 });
  const form = document.createElement('form');
  form.innerHTML =
    '<input data-offline-enabled type="checkbox" checked><input data-offline-days value="3"><button data-offline-save type="button"></button><button data-offline-purge type="button"></button>';
  app.element = form;
  g.game.users = new Map([[g.game.user.id, g.game.user]]);
  await app._onRender(context, {});
  const button = form.querySelector<HTMLButtonElement>('[data-offline-save]')!;
  expect(button.onclick).toBeTypeOf('function');
  await button.onclick!.call(button, new MouseEvent('click'));
  expect(set).toHaveBeenCalledWith('agent-gateway', 'offlineEventReading', {
    enabled: true,
    retentionDays: 3,
  });
  set.mockClear();
  g.game.user.isGM = false;
  await button.onclick!.call(button, new MouseEvent('click'));
  expect(set).not.toHaveBeenCalled();
  const player = new App();
  player.element = form.cloneNode(true);
  await player._onRender({}, {});
  expect(player.element.querySelector('[data-offline-save]').onclick).toBeNull();
});
