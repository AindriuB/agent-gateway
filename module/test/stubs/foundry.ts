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
  opts: { sceneLevels?: boolean; stringStorage?: boolean } = {},
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
  const hooks = new Map<string, Array<() => void>>();
  const collection = () => ({ get: () => undefined, contents: [] as unknown[], size: 0 });

  g.game = {
    release: { generation },
    settings: {
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
      set: async (ns: string, key: string, v: unknown) =>
        void values.set(
          `${ns}.${key}`,
          // Like localStorage: with stringStorage, only strings survive a round trip.
          opts.stringStorage && typeof v !== 'string' ? JSON.stringify(v) : v,
        ),
    },
    actors: collection(),
    items: collection(),
    scenes: collection(),
    journal: collection(),
    users: collection(),
  };
  g.Hooks = {
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
    registeredMenus,
    hooks,
    fire: (hook) => (hooks.get(hook) ?? []).forEach((fn) => fn()),
    uninstall: () => Object.assign(g, saved),
  };
}
