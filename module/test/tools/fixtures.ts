/* eslint-disable @typescript-eslint/no-explicit-any */
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';

export const gmUser = { id: 'gm1', name: 'Gamemaster', role: 4, isGM: true };
export const playerUser = { id: 'p1', name: 'Pat', role: 1, isGM: false };

export interface FakeDoc {
  id: string;
  uuid: string;
  name: string;
  documentName: string;
  folder?: { id: string; name: string };
  /** user ids allowed to observe */
  observers: string[];
  data: Record<string, unknown>;
}

export const fakeDoc = (
  d: Partial<FakeDoc> & Pick<FakeDoc, 'id' | 'name' | 'documentName'>,
): FakeDoc & Record<string, any> => {
  const full: FakeDoc = {
    uuid: `${d.documentName}.${d.id}`,
    observers: [],
    data: {},
    ...d,
  };
  return {
    ...full,
    testUserPermission: (user: { id: string }, level: string) =>
      level === 'OBSERVER' && (user.id === gmUser.id || full.observers.includes(user.id)),
    toObject: () => ({ _id: full.id, name: full.name, ...full.data }),
  };
};

const collection = (docs: any[]) => ({
  contents: docs,
  get: (id: string) => docs.find((d) => d.id === id),
});

export interface WorldSetup {
  docs?: Record<string, any[]>;
  activeScene?: { name: string };
  combatActive?: boolean;
  optIn?: boolean;
}

export function setupWorld(w: WorldSetup = {}): FoundryStub {
  const stub = installFoundry(14);
  const g = globalThis as any;
  const docs = w.docs ?? {};
  const byUuid = new Map<string, any>();
  for (const list of Object.values(docs)) for (const d of list) byUuid.set(d.uuid, d);
  Object.assign(g.game, {
    world: { id: 'my-world', title: 'My World' },
    system: { id: 'dnd5e', version: '5.1.0' },
    users: collection([gmUser, playerUser]),
    actors: collection(docs.actors ?? []),
    items: collection(docs.items ?? []),
    journal: collection(docs.journal ?? []),
    scenes: Object.assign(collection(docs.scenes ?? []), { active: w.activeScene }),
    tables: collection(docs.tables ?? []),
    macros: collection(docs.macros ?? []),
    playlists: collection(docs.playlists ?? []),
    combats: { active: w.combatActive ? {} : undefined },
  });
  stub.registeredSettings.set('agent-gateway.includeOtherModuleData', {
    name: '',
    scope: 'world',
    config: true,
    type: Boolean,
    default: w.optIn === true,
  });
  g.fromUuid = async (uuid: string) => byUuid.get(uuid) ?? null;
  return stub;
}
