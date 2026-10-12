/* eslint-disable @typescript-eslint/no-explicit-any */
/** Self-contained callback. Only one exact consented private NPC may be created/renamed/deleted. */
export async function task28NativeState(input: any): Promise<any> {
  const g = globalThis as any,
    game = g.game;
  const guards = {
    authority() {
      if (
        !game?.ready ||
        game.world.id !== 'test-world' ||
        Number(game.release.generation) !== input.generation ||
        !game.user?.isGM ||
        game.users.get(game.user.id) !== game.user ||
        game.users.activeGM !== game.user ||
        game.users.filter((u: any) => u.active && u.isGM).length !== 1 ||
        (input.baseline && game.user.id !== input.baseline.gm.id)
      )
        throw Error('Exact sole canonical native GM required');
      if (input.baseline && game.time.worldTime !== input.baseline.worldTime)
        throw Error('World time changed');
    },
    roots() {
      return Object.fromEntries(
        [
          'actors',
          'items',
          'journal',
          'scenes',
          'combats',
          'tables',
          'playlists',
          'macros',
          'messages',
        ].map((key) => [key, game[key].contents.map((d: any) => d.uuid).sort()]),
      );
    },
    source(d: any) {
      const value = JSON.stringify(d.toObject());
      if (value.length > 1048576) throw Error('Native source bound exceeded');
      return value;
    },
    views() {
      return {
        sceneId: g.canvas.scene?.id ?? null,
        levelId: g.canvas.level?.id ?? null,
        targets: [...game.user.targets].map((t: any) => t.id).sort(),
        combatUuid: g.ui.combat?.viewed?.uuid ?? null,
        activeScenes: game.scenes.contents
          .filter((s: any) => s.active)
          .map((s: any) => s.id)
          .sort(),
      };
    },
    queue() {
      const raw = localStorage.getItem(`agent-gateway.${game.world.id}.approvalQueue`);
      const rows = raw === null ? [] : (JSON.parse(raw)[game.user.id] ?? []);
      if (
        !Array.isArray(rows) ||
        rows.some((r: any) => r.status === 'pending' || (r.status === 'approved' && !r.result))
      )
        throw Error('Existing unsettled native approval');
    },
    unchanged() {
      guards.authority();
      guards.queue();
      if (JSON.stringify(guards.views()) !== JSON.stringify(input.baseline.views))
        throw Error('GM views changed');
      const roots = guards.roots();
      if (input.uuid) roots.actors = roots.actors.filter((uuid: string) => uuid !== input.uuid);
      if (JSON.stringify(roots) !== JSON.stringify(input.baseline.roots))
        throw Error('Unrelated native roots changed');
      for (const saved of input.baseline.sources) {
        const d = game[saved.collection].get(saved.id);
        if (!d || guards.source(d) !== saved.source) throw Error('Original native source changed');
      }
    },
    fixture() {
      const pins = g.__task28Pins?.get(input.run),
        d = pins?.actor;
      if (
        !d ||
        !(d instanceof g.CONFIG.Actor.documentClass) ||
        d.documentName !== 'Actor' ||
        game.actors.get(d.id) !== d ||
        d.parent ||
        d.pack ||
        d.uuid !== input.uuid ||
        input.baseline.roots.actors.includes(d.uuid) ||
        d.flags?.world?.task28 !== input.run ||
        d.type !== 'npc' ||
        d.name !== pins.name
      )
        throw Error('Exact returned canonical fixture required');
      const source = d.toObject();
      delete source._stats;
      if (JSON.stringify(source) !== pins.source) throw Error('Fixture full source changed');
      if (!Number.isFinite(d._stats?.modifiedTime))
        throw Error('Finite native Actor version required');
      return { d, pins };
    },
  };
  guards.authority();
  if (input.op === 'baseline') {
    guards.queue();
    if (
      !Number.isFinite(game.time.worldTime) ||
      game.modules.contents.some((m: any) => m.active && m.id !== 'agent-gateway') ||
      !game.modules.get('agent-gateway')?.active
    )
      throw Error('Isolated native module baseline required');
    const roots = guards.roots(),
      sources = [];
    for (const collection of Object.keys(roots)) {
      if (game[collection].contents.length > 1000) throw Error('Bounded baseline roots required');
      for (const d of game[collection].contents)
        sources.push({ collection, id: d.id, source: guards.source(d) });
    }
    const player = game.users.getName(input.playerName);
    if (!player || player.isGM || game.users.get(player.id) !== player)
      throw Error('Exact canonical Player1 required');
    return {
      gm: { id: game.user.id, name: game.user.name },
      player: { id: player.id, name: player.name },
      worldTime: game.time.worldTime,
      version: game.version,
      generation: game.release.generation,
      roots,
      sources,
      views: guards.views(),
    };
  }
  guards.unchanged();
  if (input.op === 'create') {
    if (g.__task28Pins?.has(input.run)) throw Error('Fixture nonce already used');
    const d = await g.CONFIG.Actor.documentClass.create(input.plan.actor, { renderSheet: false });
    guards.authority();
    if (
      !d ||
      !(d instanceof g.CONFIG.Actor.documentClass) ||
      game.actors.get(d.id) !== d ||
      d.documentName !== 'Actor' ||
      d.parent ||
      d.pack ||
      input.baseline.roots.actors.includes(d.uuid) ||
      d.flags?.world?.task28 !== input.run ||
      d.name !== input.plan.actor.name ||
      d.type !== 'npc' ||
      d.items.size ||
      d.effects.size ||
      d.ownership.default !== 0 ||
      d.testUserPermission(game.users.get(input.baseline.player.id), 'OBSERVER')
    )
      throw Error('Private native fixture create postcondition failed');
    const source = d.toObject();
    delete source._stats;
    (g.__task28Pins ??= new Map()).set(input.run, {
      actor: d,
      name: d.name,
      source: JSON.stringify(source),
    });
    return { uuid: d.uuid, id: d.id, source: d.toObject() };
  }
  if (input.op === 'facts') {
    const { d } = guards.fixture();
    return {
      uuid: d.uuid,
      name: d.name,
      source: d.toObject(),
      worldTime: game.time.worldTime,
      views: guards.views(),
    };
  }
  if (input.op === 'rename') {
    const { d, pins } = guards.fixture();
    if (
      ![0, 1].includes(input.index) ||
      d.name !== (input.index === 0 ? input.plan.actor.name : input.plan.names[0])
    )
      throw Error('Exactly two sequential fixture name updates required');
    const expected = d.toObject();
    delete expected._stats;
    expected.name = input.plan.names[input.index];
    await d.update({ name: expected.name }, { render: false });
    guards.authority();
    if (game.actors.get(d.id) !== d || d.name !== expected.name)
      throw Error('Fixture rename native postcondition failed');
    const actual = d.toObject();
    delete actual._stats;
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw Error('Unexpected fixture update side effect');
    pins.name = d.name;
    pins.source = JSON.stringify(actual);
    guards.unchanged();
    return { uuid: d.uuid, name: d.name, source: d.toObject(), worldTime: game.time.worldTime };
  }
  if (input.op === 'cleanup') {
    const { d } = guards.fixture();
    await d.delete({ render: false });
    guards.authority();
    if (game.actors.get(d.id)) throw Error('Exact fixture deletion incomplete');
    guards.unchanged();
    g.__task28Pins.delete(input.run);
    return {
      absent: [d.uuid],
      worldTimeUnchanged: true,
      viewsUnchanged: true,
      rootsUnchanged: true,
      originalSourcesUnchanged: true,
    };
  }
  throw Error('Unsupported native fixture operation');
}

/** Read-only participant identity/view baseline; never changes a native view or setting. */
export function task28ParticipantState(input: any): any {
  const g = globalThis as any,
    game = g.game;
  if (
    !game?.ready ||
    game.world.id !== 'test-world' ||
    Number(game.release.generation) !== input.generation ||
    game.users.get(game.user.id) !== game.user ||
    game.user.id !== input.user.id ||
    game.user.isGM !== input.isGM ||
    game.time.worldTime !== input.worldTime
  )
    throw Error('Exact canonical native participant required');
  return {
    id: game.user.id,
    name: game.user.name,
    isGM: game.user.isGM,
    worldId: game.world.id,
    generation: game.release.generation,
    worldTime: game.time.worldTime,
    views: {
      sceneId: g.canvas.scene?.id ?? null,
      levelId: g.canvas.level?.id ?? null,
      targets: [...game.user.targets].map((t: any) => t.id).sort(),
      combatUuid: g.ui.combat?.viewed?.uuid ?? null,
    },
  };
}
