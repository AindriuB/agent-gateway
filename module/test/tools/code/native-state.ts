/* eslint-disable @typescript-eslint/no-explicit-any */
/** Self-contained native callback: only the exact approved nonce Macro can be created/deleted. */
export async function task26NativeState(input: any): Promise<any> {
  const g = globalThis as any,
    game = g.game;
  const guards = {
    gm() {
      if (
        !game.ready ||
        game.world.id !== 'test-world' ||
        Number(game.release.generation) !== input.generation ||
        !game.user?.isGM ||
        game.users.get(game.user.id) !== game.user ||
        game.users.activeGM !== game.user ||
        game.users.filter((u: any) => u.active && u.isGM).length !== 1 ||
        (input.baseline && game.user.id !== input.baseline.gm.id)
      )
        throw Error('Exact sole native GM prerequisite failed');
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
    queue() {
      const raw = localStorage.getItem(`agent-gateway.${game.world.id}.approvalQueue`);
      if (raw === null) return [];
      const queue = JSON.parse(raw)[game.user.id] ?? [];
      if (!Array.isArray(queue)) throw Error('Native approval queue unavailable');
      return queue;
    },
    audit() {
      const selected = game.settings.get('agent-gateway', 'auditJournalId'),
        anchor = game.settings.storage.get('world').getSetting('agent-gateway.auditJournalId'),
        audit = game.journal.get(selected);
      if (
        anchor?.value !== selected ||
        anchor.user !== null ||
        !game.users.get(anchor._stats?.lastModifiedBy)?.isGM ||
        audit?.flags?.['agent-gateway']?.auditJournal !== true ||
        audit.ownership.default !== 0 ||
        game.users.some((u: any) => !u.isGM && audit.getUserLevel(u) !== 0) ||
        !game.documentTypes.JournalEntryPage.includes('agent-gateway.audit')
      )
        throw Error('Trusted private native audit required');
      const pinned = g.__task26AuditPins?.get(input.run);
      if (
        input.baseline &&
        (selected !== input.baseline.auditJournalId ||
          !pinned ||
          pinned.audit !== audit ||
          pinned.anchor !== anchor ||
          pinned.anchorSource !== JSON.stringify(anchor))
      )
        throw Error('Original canonical audit journal changed');
      return { audit, anchor, selected };
    },
    owned(d: any) {
      if (
        !d ||
        d.documentName !== 'Macro' ||
        d.parent ||
        d.pack ||
        game.macros.get(d.id) !== d ||
        d.uuid !== `Macro.${d.id}` ||
        d.flags?.world?.task26 !== input.run ||
        input.baseline.roots.macros.includes(d.uuid) ||
        d.command !== input.source.command ||
        d.type !== 'script' ||
        d.name !== input.source.name
      )
        throw Error('Exact canonical harmless fixture custody failed');
    },
  };
  guards.gm();
  if (input.op === 'baseline') {
    if (
      game.modules.contents.some((m: any) => m.active && m.id !== 'agent-gateway') ||
      !game.modules.get('agent-gateway')?.active
    )
      throw Error('Isolated active native module required');
    const { audit, anchor, selected } = guards.audit();
    (g.__task26AuditPins ??= new Map()).set(input.run, {
      audit,
      anchor,
      anchorSource: JSON.stringify(anchor),
    });
    if (
      guards
        .queue()
        .some((r: any) => r.status === 'pending' || (r.status === 'approved' && !r.result))
    )
      throw Error('Existing pending or running approval');
    if (!Number.isFinite(game.time.worldTime) || game.macros.contents.length > 1000)
      throw Error('Bounded native baseline required');
    return {
      auditJournalId: selected,
      gm: { id: game.user.id, name: game.user.name },
      version: game.version,
      generation: game.release.generation,
      worldTime: game.time.worldTime,
      roots: guards.roots(),
      views: guards.views(),
      macros: game.macros.contents.map((d: any) => ({
        uuid: d.uuid,
        source: JSON.stringify(d.toObject()),
      })),
      audits: audit.pages.contents.map((p: any) => p.uuid),
      policy: game.settings.get('agent-gateway', 'worldPolicy'),
    };
  }
  if (game.time.worldTime !== input.baseline.worldTime) throw Error('Native world time changed');
  if (input.op === 'create') {
    const d = await g.CONFIG.Macro.documentClass.create(input.source, { renderSheet: false });
    guards.gm();
    guards.owned(d);
    return { uuid: d.uuid, id: d.id, source: d.toObject() };
  }
  if (input.op === 'queue') return guards.queue();
  if (input.op === 'audits') {
    return guards
      .audit()
      .audit.pages.contents.map((p: any) => ({ uuid: p.uuid, ...p.system.toObject() }));
  }
  if (input.op === 'facts') {
    const matches = game.macros.contents.filter((d: any) => d.flags?.world?.task26 === input.run);
    if (matches.length !== 1) throw Error('Exact one fixture Macro required');
    guards.owned(matches[0]);
    if (JSON.stringify(guards.views()) !== JSON.stringify(input.baseline.views))
      throw Error('Native views changed');
    return {
      uuid: matches[0].uuid,
      command: matches[0].command,
      worldTime: game.time.worldTime,
      views: guards.views(),
    };
  }
  if (input.op === 'cleanup') {
    guards.audit();
    if (
      guards
        .queue()
        .some((r: any) => r.status === 'pending' || (r.status === 'approved' && !r.result))
    )
      throw Error('Calls not terminal: manual reconciliation required');
    const matches = game.macros.contents.filter((d: any) => d.flags?.world?.task26 === input.run);
    if (matches.length > 1)
      throw Error('Ambiguous fixture identity: manual reconciliation required');
    for (const d of matches) {
      guards.gm();
      guards.owned(d);
      if (input.uuid && d.uuid !== input.uuid) throw Error('Returned fixture identity changed');
      await d.delete({ render: false });
      guards.gm();
      if (game.macros.get(d.id)) throw Error('Fixture deletion incomplete');
    }
    if (
      JSON.stringify(guards.roots()) !== JSON.stringify(input.baseline.roots) ||
      JSON.stringify(guards.views()) !== JSON.stringify(input.baseline.views) ||
      game.time.worldTime !== input.baseline.worldTime
    )
      throw Error('Native roots/views/time did not remain unchanged');
    for (const saved of input.baseline.macros) {
      const d = game.macros.contents.find((row: any) => row.uuid === saved.uuid);
      if (!d || JSON.stringify(d.toObject()) !== saved.source)
        throw Error('Original Macro source changed');
    }
    return {
      absent: input.uuid
        ? !game.macros.contents.some((d: any) => d.uuid === input.uuid)
        : matches.length,
      worldTimeUnchanged: true,
      viewsUnchanged: true,
      rootsUnchanged: true,
      macroSourcesUnchanged: true,
    };
  }
  throw Error('Unsupported native state operation');
}
