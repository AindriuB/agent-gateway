/* eslint-disable @typescript-eslint/no-explicit-any */
export type Generation = 13 | 14;

export interface SettingConfig {
  name: string;
  hint?: string;
  scope: 'client' | 'world';
  config: boolean;
  type: unknown;
  default: unknown;
  restricted?: boolean;
}

export interface FoundryStub {
  registeredSettings: Map<string, SettingConfig>;
  worldSettings: Map<string, any>;
  registeredMenus: Map<string, any>;
  hooks: Map<string, Array<() => void>>;
  fire(hook: string): void;
  uninstall(): void;
}

class ApplicationV2 {}
const HandlebarsApplicationMixin = (base: any) => class extends base {};

/** Install minimal Foundry globals for the given generation. */
export function installFoundry(
  generation: Generation,
  opts: {
    sceneLevels?: boolean;
    stringStorage?: boolean;
    worldSettingWriter?: () => string | undefined;
    persistedWorldSettings?: boolean;
  } = {},
): FoundryStub {
  const g = globalThis as any;
  const saved = {
    game: g.game,
    Hooks: g.Hooks,
    CONST: g.CONST,
    foundry: g.foundry,
    fromUuid: g.fromUuid,
  };
  const registeredSettings = new Map<string, SettingConfig>();
  const registeredMenus = new Map<string, any>();
  const values = new Map<string, unknown>();
  const worldSettings = new Map<string, any>();
  const hooks = new Map<string, Array<() => void>>();
  // Tool tests act as player agents, which are off in a fresh world; policy tests set this explicitly.
  values.set('agent-gateway.playerAgentsEnabled', true);
  values.set('agent-gateway.headlessAgentsEnabled', false);
  values.set('agent-gateway.folderAllowlist', JSON.stringify({ playerAgents: [], gmAgents: [] }));
  values.set('agent-gateway.worldPolicySnapshotMigrated', false);
  // The registered default world policy (spec section 3), as an unset real world would hold it.
  values.set(
    'agent-gateway.worldPolicy',
    JSON.stringify({
      playerAgents: { read: 'allow', write: 'ask_owner', destructive: 'ask_gm', code: 'ask_gm' },
      gmAgents: { read: 'allow', write: 'ask_owner', destructive: 'ask_owner', code: 'ask_owner' },
    }),
  );
  // Tool tests share one rate limiter and call far more than 60 times; give them a generous limit.
  // Rate-limit tests set the setting they mean.
  values.set(
    'agent-gateway.rateLimits',
    JSON.stringify({
      playerAgents: { read: 10000, write: 10000 },
      gmAgents: { read: 10000, write: 10000 },
      agents: {},
    }),
  );
  const collection = () => ({ get: () => undefined, contents: [] as unknown[], size: 0 });

  g.game = {
    modules: new Map([['agent-gateway', { active: true }]]),
    release: { generation },
    settings: {
      storage: new Map([
        [
          'world',
          {
            get: (id: string) => [...worldSettings.values()].find((doc) => doc.id === id),
            get contents() {
              return [...worldSettings.values()];
            },
            getSetting: (key: string, user: string | null = null) => {
              const doc = worldSettings.get(key);
              return doc?.user === user ? doc : undefined;
            },
          },
        ],
      ]),
      register: (ns: string, key: string, cfg: SettingConfig) =>
        registeredSettings.set(`${ns}.${key}`, cfg),
      registerMenu: (ns: string, key: string, cfg: any) => {
        // Same rule as Foundry: the type must be a subclass of ApplicationV2.
        if (!(cfg?.type?.prototype instanceof ApplicationV2)) {
          throw new Error(
            'You must provide a menu type that is a FormApplication or ApplicationV2 instance or subclass',
          );
        }
        registeredMenus.set(`${ns}.${key}`, cfg);
      },
      get: (ns: string, key: string) =>
        values.get(`${ns}.${key}`) ?? registeredSettings.get(`${ns}.${key}`)?.default,
      set: async (ns: string, key: string, v: unknown) => {
        const full = `${ns}.${key}`;
        values.set(full, opts.stringStorage && typeof v !== 'string' ? JSON.stringify(v) : v);
        // Explicit test-only writer injection: no invented GM proof for ordinary settings.
        if (
          (registeredSettings.get(full)?.scope === 'world' && opts.worldSettingWriter) ||
          (opts.persistedWorldSettings && key !== 'ownerPolicy')
        ) {
          worldSettings.set(full, {
            id: worldSettings.get(full)?.id ?? `setting-${worldSettings.size}`,
            key: full,
            user: null,
            _source: {
              _id: worldSettings.get(full)?.id ?? `setting-${worldSettings.size}`,
              key: full,
              user: null,
              value: JSON.stringify(v),
            },
            value: v,
            _stats: { lastModifiedBy: opts.worldSettingWriter?.() },
          });
        }
      },
    },
    actors: collection(),
    items: collection(),
    scenes: collection(),
    journal: collection(),
    users: collection(),
    packs: collection(),
    messages: collection(),
  };
  g.Hooks = {
    callAll: (name: string, ...args: unknown[]) =>
      (hooks.get(name) ?? []).forEach((fn) => (fn as (...args: unknown[]) => void)(...args)),
    once: (name: string, fn: () => void) => hooks.set(name, [...(hooks.get(name) ?? []), fn]),
    on: (name: string, fn: () => void) => hooks.set(name, [...(hooks.get(name) ?? []), fn]),
  };
  g.CONST = { USER_ROLES: { NONE: 0, PLAYER: 1, TRUSTED: 2, ASSISTANT: 3, GAMEMASTER: 4 } };
  g.foundry = {
    applications: { api: { ApplicationV2, HandlebarsApplicationMixin } },
    documents: generation === 14 && opts.sceneLevels !== false ? { BaseLevel: class {} } : {},
  };
  g.fromUuid = async (uuid: string) => ({ uuid });

  return {
    registeredSettings,
    worldSettings,
    registeredMenus,
    hooks,
    fire: (hook) => (hooks.get(hook) ?? []).forEach((fn) => fn()),
    uninstall: () => Object.assign(g, saved),
  };
}
