/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, expect, it, vi } from 'vitest';
import { tokenManageHandler } from '../../../src/tools/token-manage.js';
import { combatManageHandler } from '../../../src/tools/combat-manage.js';
import { sceneControlHandler } from '../../../src/tools/scene-control.js';
import { setup, g, gm } from '../player-tokens-combat/fixtures.js';
let f: ReturnType<typeof setup>;
afterEach(() => f?.restore());
function base(args: any) {
  f = setup();
  g.game.user = gm;
  f.scene.testUserPermission = () => true;
  f.scene._stats = { modifiedTime: 1 };
  f.combat.testUserPermission = () => true;
  f.combat.scene = f.scene;
  f.combat._source = { scene: 's' };
  f.docs.set(f.scene.uuid, f.scene);
  f.docs.set(f.combat.uuid, f.combat);
  for (const c of f.combat.turns) {
    c.documentName = 'Combatant';
    c._stats = { modifiedTime: 1 };
    f.docs.set(c.uuid, c);
  }
  return {
    user: gm,
    agent: { id: 'agent', ownerUserId: 'gm', headless: false },
    sessionId: 's',
    tool: 'fixture',
    args,
    snapshot: vi.fn(async () => {}),
    intendCreate: vi.fn(async () => {}),
    created: vi.fn(async () => {}),
    callOptions: { agentGateway: { callId: 'audit' } },
  } as any;
}
it.each(['hide', 'show'])(
  'native token %s forwards audit options and validates result',
  async (action) => {
    const ctx = base({ action, tokenUuid: 'Scene.s.Token.t' });
    const t = f.token();
    t.update = vi.fn(async (data: any, opts: any) => {
      expect(opts).toBe(ctx.callOptions);
      Object.assign(t, data);
      return t;
    });
    expect(await tokenManageHandler(ctx)).toMatchObject({ structured: { completed: true } });
    expect(ctx.snapshot).toHaveBeenCalledWith(t.uuid);
  },
);
it('refuses token deletion referencing global encounter', async () => {
  const ctx = base({ action: 'remove', tokenUuid: 'Scene.s.Token.t' });
  const t = f.token();
  t.delete = vi.fn();
  const c = f.combat.combatant;
  c.documentName = 'Combatant';
  c.sceneId = 's';
  c.tokenId = t.id;
  f.combat.scene = null;
  g.game.combats.contents = [f.combat];
  f.combat.combatants.contents = [c];
  expect(await tokenManageHandler(ctx)).toMatchObject({ error: { code: 'FORBIDDEN' } });
  expect(t.delete).not.toHaveBeenCalled();
});
it('fails closed on demotion during snapshot', async () => {
  const ctx = base({ action: 'hide', tokenUuid: 'Scene.s.Token.t' });
  const t = f.token();
  t.update = vi.fn();
  ctx.snapshot = async () => {
    g.game.user = { id: 'other' };
  };
  expect(await tokenManageHandler(ctx)).toMatchObject({ error: { code: 'FORBIDDEN' } });
  expect(t.update).not.toHaveBeenCalled();
});
it('refuses incorrect action fields before native calls', async () => {
  const ctx = base({ action: 'hide', tokenUuid: 'Scene.s.Token.t', sceneUuid: 'Scene.s' });
  expect(await tokenManageHandler(ctx)).toMatchObject({ error: { code: 'INVALID_ARGS' } });
  expect(ctx.snapshot).not.toHaveBeenCalled();
});
it('refuses unsupported PF2e initiative before any roll or snapshot', async () => {
  const ctx = base({
    action: 'roll_initiative',
    combatUuid: 'Combat.c',
    combatantUuids: ['Combat.c.Combatant.a'],
  });
  const c = f.combat.combatant;
  c.documentName = 'Combatant';
  c.getInitiativeRoll = vi.fn();
  g.game.system = { id: 'pf2e' };
  expect(await combatManageHandler(ctx)).toMatchObject({ error: { code: 'INVALID_ARGS' } });
  expect(c.getInitiativeRoll).not.toHaveBeenCalled();
  expect(ctx.snapshot).not.toHaveBeenCalled();
});
it('v13 level refusal has exact supported error', async () => {
  const ctx = base({ action: 'set_level', sceneUuid: 'Scene.s', levelId: 'l' });
  g.game.release.generation = 13;
  expect(await sceneControlHandler(ctx)).toMatchObject({
    error: { code: 'INVALID_ARGS', message: 'requires Foundry v14 Scene Levels' },
  });
  expect(ctx.snapshot).not.toHaveBeenCalled();
});
it('honors native darkness lock without unlocking', async () => {
  const ctx = base({ action: 'set_darkness', sceneUuid: 'Scene.s', darkness: 0.5 });
  f.scene.environment = { darknessLevel: 0, darknessLock: true };
  f.scene.update = vi.fn();
  expect(await sceneControlHandler(ctx)).toMatchObject({ error: { code: 'INVALID_ARGS' } });
  expect(f.scene.update).not.toHaveBeenCalled();
});
it('validates cancelled native darkness update', async () => {
  const ctx = base({ action: 'set_darkness', sceneUuid: 'Scene.s', darkness: 0.5 });
  f.scene.environment = { darknessLevel: 0, darknessLock: false };
  f.scene.update = vi.fn(async () => undefined);
  await expect(sceneControlHandler(ctx)).rejects.toThrow('did not persist');
});
it('rejects wrong-parent selected combatant before mutation', async () => {
  const ctx = base({
    action: 'remove_combatants',
    combatUuid: 'Combat.c',
    combatantUuids: ['Combat.c.Combatant.a'],
  });
  const c = f.combat.combatant;
  c.documentName = 'Combatant';
  c.parent = { ...f.combat };
  f.combat.deleteEmbeddedDocuments = vi.fn();
  expect(await combatManageHandler(ctx)).toMatchObject({ error: { code: 'FORBIDDEN' } });
  expect(f.combat.deleteEmbeddedDocuments).not.toHaveBeenCalled();
});
it.each(['valid', 'footprint', 'hidden', 'demoted'])(
  'token placement validates native %s result and records creation honestly',
  async (mode) => {
    const ctx = base({
      action: 'place',
      sceneUuid: 'Scene.s',
      actorUuid: 'Actor.a',
      x: 100,
      y: 100,
      hidden: true,
    });
    const actor: any = {
      id: 'a',
      uuid: 'Actor.a',
      documentName: 'Actor',
      _stats: { modifiedTime: 1 },
      testUserPermission: () => true,
    };
    g.game.actors = new Map([['a', actor]]);
    f.docs.set(actor.uuid, actor);
    const prepared: any = {
      documentName: 'Token',
      parent: f.scene,
      getSize: () => ({ width: 100, height: 100 }),
      toObject: () => ({ actorId: 'a', x: 100, y: 100, hidden: true }),
    };
    actor.getTokenDocument = vi.fn(async () => {
      if (mode === 'demoted') g.game.user = { id: 'wrong' };
      return prepared;
    });
    f.scene.createEmbeddedDocuments = vi.fn(async (_type: any, data: any[], options: any) => {
      expect(options).toBe(ctx.callOptions);
      const t = f.token();
      Object.assign(t, data[0]);
      t.actorId = 'a';
      if (mode === 'footprint') t.width = 50;
      if (mode === 'hidden') t.hidden = false;
      return [t];
    });
    if (mode === 'valid') {
      expect(await tokenManageHandler(ctx)).toMatchObject({ structured: { completed: true } });
      expect(ctx.created).toHaveBeenCalledWith('Scene.s.Token.t', 'Scene.s');
    } else if (mode === 'demoted') {
      expect(await tokenManageHandler(ctx)).toMatchObject({ error: { code: 'FORBIDDEN' } });
      expect(f.scene.createEmbeddedDocuments).not.toHaveBeenCalled();
    } else {
      if (mode === 'footprint')
        expect(await tokenManageHandler(ctx)).toMatchObject({ error: { code: 'INVALID_ARGS' } });
      else await expect(tokenManageHandler(ctx)).rejects.toThrow();
      expect(ctx.created).toHaveBeenCalledWith('Scene.s.Token.t', 'Scene.s');
    }
  },
);
it('combat addition uses native scene document and rejects a filtered partial result honestly', async () => {
  const ctx = base({
    action: 'add_combatants',
    combatUuid: 'Combat.c',
    tokenUuids: ['Scene.s.Token.t'],
  });
  const t = f.token();
  t.actorId = 'a';
  f.combat.combatants.contents = [];
  f.combat.createEmbeddedDocuments = vi.fn(async () => []);
  await expect(combatManageHandler(ctx)).rejects.toThrow('only part');
  expect(f.combat.createEmbeddedDocuments.mock.calls[0][0]).toBe('Combatant');
  expect(ctx.intendCreate).toHaveBeenCalledWith('Combat.c');
});
it('removes an unlinked NPC combatant without requiring synthetic actor root identity', async () => {
  const ctx = base({
    action: 'remove_combatants',
    combatUuid: 'Combat.c',
    combatantUuids: ['Combat.c.Combatant.a'],
  });
  const c = f.combat.combatant;
  const t = f.token();
  c.actor = { parent: t, _stats: { modifiedTime: 1 } };
  f.combat.deleteEmbeddedDocuments = vi.fn(async (_type: any, ids: string[], opts: any) => {
    expect(opts).toBe(ctx.callOptions);
    for (const id of ids) f.combat.combatants.delete(id);
    return [c];
  });
  expect(await combatManageHandler(ctx)).toMatchObject({
    structured: { completed: true, affected: [c.uuid] },
  });
});
it('rejects demotion during token delete after the native partial mutation', async () => {
  const ctx = base({ action: 'remove', tokenUuid: 'Scene.s.Token.t' });
  const t = f.token();
  g.game.combats.contents = [];
  t.delete = vi.fn(async () => {
    f.scene.tokens.delete(t.id);
    g.game.user = { id: 'wrong' };
    return t;
  });
  expect(await tokenManageHandler(ctx)).toMatchObject({ error: { code: 'FORBIDDEN' } });
  expect(f.scene.tokens.has(t.id)).toBe(false);
});
it('core initiative applies audited options with turnEvents false even without current combatant', async () => {
  const ctx = base({
    action: 'roll_initiative',
    combatUuid: 'Combat.c',
    combatantUuids: ['Combat.c.Combatant.a'],
  });
  const c = f.combat.turns[0];
  f.combat.turn = null;
  g.game.system = { id: 'test' };
  const formula = () => '1d20';
  const getInitiativeRoll = function () {
    return { formula: '1d20', total: 15, evaluate: vi.fn() };
  };
  g.foundry.documents.Combatant = {
    prototype: { getInitiativeRoll, _getInitiativeFormula: formula },
  };
  c.getInitiativeRoll = getInitiativeRoll;
  c._getInitiativeFormula = formula;
  f.combat.updateEmbeddedDocuments = vi.fn(async (_type: any, updates: any[], opts: any) => {
    expect(opts).toMatchObject({ agentGateway: { callId: 'audit' }, turnEvents: false });
    Object.assign(c, updates[0]);
    return [c];
  });
  expect(await combatManageHandler(ctx)).toMatchObject({ structured: { completed: true } });
  expect(c.initiative).toBe(15);
});
it('v14 level view uses canonical level without activating scene', async () => {
  const ctx = base({ action: 'set_level', sceneUuid: 'Scene.s', levelId: 'l' });
  g.foundry.documents.BaseLevel = function () {};
  const level = { id: 'l', parent: f.scene };
  f.scene.levels = new Map([['l', level]]);
  f.scene.activate = vi.fn();
  f.scene.view = vi.fn(async (opts: any) => {
    expect(opts).toEqual({ level: 'l' });
    g.canvas.level = level;
    return f.scene;
  });
  expect(await sceneControlHandler(ctx)).toMatchObject({ structured: { completed: true } });
  expect(f.scene.activate).not.toHaveBeenCalled();
});

it('refuses null-to-scene encounter change during snapshot even with identical timestamp', async () => {
  const ctx = base({ action: 'end', combatUuid: 'Combat.c' });
  f.combat.scene = null;
  f.combat.delete = vi.fn();
  ctx.snapshot = async () => {
    f.combat.scene = f.scene;
  };
  await expect(combatManageHandler(ctx)).rejects.toThrow('scene changed');
  expect(f.combat.delete).not.toHaveBeenCalled();
});
it('refuses wrong native returned deletion documents even when selected UUID disappeared', async () => {
  const ctx = base({
    action: 'remove_combatants',
    combatUuid: 'Combat.c',
    combatantUuids: ['Combat.c.Combatant.a'],
  });
  const c = f.combat.combatant;
  f.combat.deleteEmbeddedDocuments = vi.fn(async () => {
    f.combat.combatants.delete(c.id);
    return [{ ...c }];
  });
  await expect(combatManageHandler(ctx)).rejects.toThrow('partial');
});

it('refuses scene rebinding during native start update before effect refresh', async () => {
  const ctx = base({ action: 'start', combatUuid: 'Combat.c' });
  f.combat.scene = null;
  f.combat._playCombatSound = vi.fn();
  const refresh = vi.fn();
  g.foundry.documents.ActiveEffect = { registry: { refresh } };
  f.combat.update = vi.fn(async (data: any) => {
    Object.assign(f.combat, data);
    f.combat.scene = f.scene;
    return f.combat;
  });
  await expect(combatManageHandler(ctx)).rejects.toThrow('scene changed');
  expect(refresh).not.toHaveBeenCalled();
});
