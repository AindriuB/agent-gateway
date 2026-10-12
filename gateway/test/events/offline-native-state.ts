/* eslint-disable @typescript-eslint/no-explicit-any */
/** Self-contained callback. Only one exact consented private NPC may be created/renamed/deleted. */
export async function task29NativeState(input: any): Promise<any> {
  const g = globalThis as any,
    game = g.game;
  const guards = {
    settings() {
      const rows = game.settings.storage.get('world').contents;
      if (!Array.isArray(rows) || rows.length > 1000)
        throw Error('Bounded native settings required');
      return rows
        .filter((row: any) => row.key !== 'agent-gateway.offlineEventReading')
        .map((row: any) => ({ id: row.id, source: guards.source(row) }))
        .sort((a: any, b: any) => a.id.localeCompare(b.id));
    },
    policy() {
      const value = game.settings.get('agent-gateway', 'offlineEventReading');
      if (
        !value ||
        typeof value.enabled !== 'boolean' ||
        !Number.isInteger(value.retentionDays) ||
        value.retentionDays < 1 ||
        value.retentionDays > 365 ||
        Object.keys(value).sort().join(',') !== 'enabled,retentionDays'
      )
        throw Error('Exact valid original offline setting required');
      return { enabled: value.enabled, retentionDays: value.retentionDays };
    },

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
      if (JSON.stringify(guards.settings()) !== JSON.stringify(input.baseline.settings))
        throw Error('Unrelated native settings changed');
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
      const pins = g.__task29Pins?.get(input.run),
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
        d.flags?.world?.task29 !== input.run ||
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
      offlinePolicy: guards.policy(),
      settings: guards.settings(),
      roots,
      sources,
      views: guards.views(),
    };
  }
  guards.unchanged();
  if (input.op === 'settingBefore' || input.op === 'settingAfter') {
    if (JSON.stringify(guards.policy()) !== JSON.stringify(input.expectedPolicy))
      throw Error('Offline setting custody changed; manual restoration required');
    return { policy: guards.policy(), worldTime: game.time.worldTime, gm: game.user.id };
  }
  if (input.op === 'openPolicy') {
    if (JSON.stringify(guards.policy()) !== JSON.stringify(input.expectedPolicy))
      throw Error('Offline setting custody changed');
    const menu = game.settings.menus.get('agent-gateway.policy');
    if (!menu?.type) throw Error('Native policy menu unavailable');
    const app = new menu.type();
    await app.render({ force: true });
    guards.authority();
    if (JSON.stringify(guards.policy()) !== JSON.stringify(input.expectedPolicy))
      throw Error('Offline setting custody changed');
    return { opened: true };
  }
  if (input.op === 'restoreSetting') {
    if (JSON.stringify(guards.policy()) !== JSON.stringify(input.expectedPolicy))
      throw Error('Offline setting custody changed; no overwrite');
    await game.settings.set('agent-gateway', 'offlineEventReading', input.baseline.offlinePolicy);
    guards.authority();
    if (JSON.stringify(guards.policy()) !== JSON.stringify(input.baseline.offlinePolicy))
      throw Error('Original setting restoration failed');
    return { originalRestored: true, policy: guards.policy() };
  }
  if (input.op === 'create') {
    if (g.__task29Pins?.has(input.run)) throw Error('Fixture nonce already used');
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
      d.flags?.world?.task29 !== input.run ||
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
    (g.__task29Pins ??= new Map()).set(input.run, {
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
    if (JSON.stringify(guards.policy()) !== JSON.stringify(input.baseline.offlinePolicy))
      throw Error('Setting must be restored before fixture deletion');
    const { d } = guards.fixture();
    await d.delete({ render: false });
    guards.authority();
    if (game.actors.get(d.id)) throw Error('Exact fixture deletion incomplete');
    guards.unchanged();
    g.__task29Pins.delete(input.run);
    return {
      absent: [d.uuid],
      worldTimeUnchanged: true,
      viewsUnchanged: true,
      rootsUnchanged: true,
      originalSourcesUnchanged: true,
      unrelatedSettingsUnchanged: true,
    };
  }
  throw Error('Unsupported native fixture operation');
}

/** Read-only participant identity/view baseline; never changes a native view or setting. */
export function task29ParticipantState(input: any): any {
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

/** Preserve actual native click semantics while observing every started UI operation. */
export function task29InstallUITracking(): void {
  const g = globalThis as any;
  if (g.__task29UIOps) throw Error('Native UI tracking already installed');
  g.__task29UIOps = [];
  for (const selector of ['[data-offline-save]', '[data-offline-purge]']) {
    const button = document.querySelector(`#agent-gateway-policy ${selector}`) as HTMLButtonElement;
    const native = button?.onclick;
    if (typeof native !== 'function') throw Error('Actual native UI handler unavailable');
    button.onclick = function (event) {
      if (g.__task29UIOps.length >= 4) throw Error('Exactly three saves and one purge permitted');
      const record = { selector, terminal: false, failed: false };
      g.__task29UIOps.push(record);
      Promise.resolve()
        .then(() => native.call(button, event))
        .then(
          () => {
            record.terminal = true;
          },
          () => {
            record.failed = true;
            record.terminal = true;
          },
        );
      return undefined;
    };
  }
}

/** Foundry getTemplate checks this native partial cache before its socket template request. */
export function task29PreloadPolicyTemplate(source: string): { path: string; compiled: true } {
  const h = (globalThis as any).Handlebars;
  const path = 'modules/agent-gateway/templates/policy/policy.hbs';
  if (
    typeof source !== 'string' ||
    source.length < 1 ||
    source.length > 65536 ||
    typeof h?.compile !== 'function' ||
    typeof h?.registerPartial !== 'function' ||
    !h.partials ||
    h.partials[path] !== undefined
  )
    throw Error('Exact fresh native policy template cache required');
  const compiled = h.compile(source, { preventIndent: true });
  if (typeof compiled !== 'function') throw Error('Native template compilation failed');
  h.registerPartial(path, compiled);
  if (h.partials[path] !== compiled) throw Error('Native template cache binding failed');
  return { path, compiled: true };
}
