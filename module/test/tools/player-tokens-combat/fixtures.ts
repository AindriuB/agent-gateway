/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from 'vitest';
import { installFoundry } from '../../stubs/foundry.js';
export const g = globalThis as any;
export const player = { id: 'p1', isGM: false };
export const other = { id: 'p2', isGM: false };
export const gm = { id: 'gm', isGM: true };
export function setup(generation: 13 | 14 = 14) {
  const stub = installFoundry(generation);
  const savedCanvas = g.canvas;
  g.game.user = player;
  g.game.users = { get: (id: string) => [player, other, gm].find((u) => u.id === id) };
  const docs = new Map<string, any>();
  const scene: any = {
    id: 's',
    uuid: 'Scene.s',
    documentName: 'Scene',
    grid: { size: 100 },
    width: 1000,
    height: 800,
    dimensions: { sceneRect: { x: 0, y: 0, width: 1000, height: 800 } },
    tokens: new Map(),
  };
  g.game.scenes = new Map([['s', scene]]);
  const tokens = new Map<string, any>();
  g.canvas = {
    ready: true,
    scene,
    tokens: {
      get: (id: string) => tokens.get(id),
      setTargets: vi.fn((ids: string[], { mode }: any) => {
        const user = g.game.user;
        const next = mode === 'acquire' ? new Set(user.targets ?? []) : new Set();
        for (const id of ids) next.add(tokens.get(id));
        user.targets = next;
      }),
    },
  };
  (player as any).targets = new Set();
  (other as any).targets = new Set();
  function token(id = 't', owners = new Set(['p1'])): any {
    const t: any = {
      id,
      uuid: `Scene.s.Token.${id}`,
      documentName: 'Token',
      parent: scene,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      hidden: false,
      movement: { state: 'completed' },
      owners,
      testUserPermission: (u: any, level: string) =>
        level === 'OWNER' && (u.isGM || owners.has(u.id)),
      toObject: () => ({ _id: id, x: t.x, y: t.y }),
      _stats: { modifiedTime: 1 },
    };
    t.getSize = () => ({ width: t.width * 100, height: t.height * 100 });
    t.object = { id, document: t, visible: true, renderable: true };
    t.move = vi.fn(async (path: any[], options: any) => {
      void options;
      Object.assign(t, path.at(-1));
      return true;
    });
    docs.set(t.uuid, t);
    scene.tokens.set(id, t);
    tokens.set(id, t.object);
    return t;
  }
  const combat: any = {
    id: 'c',
    uuid: 'Combat.c',
    documentName: 'Combat',
    round: 1,
    turn: 0,
    turns: [],
    combatants: new Map(),
    settings: { skipDefeated: false },
    getTimeDelta: vi.fn(() => 6),
    toObject: () => ({ _id: 'c', round: combat.round, turn: combat.turn }),
    _stats: { modifiedTime: 1 },
  };
  Object.defineProperty(combat, 'combatant', { get: () => combat.turns[combat.turn] });
  combat.update = vi.fn(async (data: any, options: any) => {
    void options;
    Object.assign(combat, data);
    return combat;
  });
  function combatant(id: string, fields: any = {}): any {
    const c: any = {
      id,
      uuid: `Combat.c.Combatant.${id}`,
      parent: combat,
      name: id,
      initiative: 10,
      hidden: false,
      visible: true,
      isDefeated: false,
      owners: new Set(['p1']),
      ...fields,
    };
    c.testUserPermission = (u: any) => u.isGM || c.owners.has(u.id);
    combat.turns.push(c);
    combat.combatants.set(id, c);
    return c;
  }
  combatant('a');
  combatant('b', { owners: new Set(['p2']) });
  g.game.combat = combat;
  g.game.combats = new Map([['c', combat]]);
  docs.set(combat.uuid, combat);
  g.fromUuid = vi.fn(async (uuid: string) => docs.get(uuid));
  g.Hooks.callAll = vi.fn();
  const savedUi = g.ui;
  g.ui = { notifications: { warn: vi.fn() } };
  const ctx = (tool: string, args: unknown = {}, who = player): any => ({
    tool,
    args:
      tool === 'combat_end_turn' && Object.keys(args as object).length === 0
        ? {
            combatUuid: combat.uuid,
            currentCombatantUuid: combat.combatant?.uuid,
            round: combat.round,
            turn: combat.turn,
          }
        : args,
    user: who,
    agent: { id: 'agent', ownerUserId: who.id, headless: false },
    sessionId: 'session',
    snapshot: vi.fn(async () => {}),
    intendCreate: vi.fn(),
    created: vi.fn(),
    callOptions: { agentGateway: { callId: 'call' } },
  });
  return {
    stub,
    scene,
    token,
    combat,
    combatant,
    docs,
    ctx,
    restore: () => {
      stub.uninstall();
      g.canvas = savedCanvas;
      g.ui = savedUi;
      delete (player as any).targets;
      delete (other as any).targets;
    },
  };
}
