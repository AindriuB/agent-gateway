/* eslint-disable @typescript-eslint/no-explicit-any */
/** Native browser read-only prerequisite scan. No constructors, settings or document mutations. */
export function task24Readiness(generation: 13 | 14) {
  const g = globalThis as any,
    game = g.game;
  if (
    !game.ready ||
    game.world.id !== 'test-world' ||
    game.system.id !== 'pf2e' ||
    Number(game.release.generation) !== generation
  )
    throw Error('Exact test-world generation/system required');
  const active = game.users.filter((u: any) => u.active);
  if (
    !game.user.isGM ||
    game.users.activeGM !== game.user ||
    active.length !== 1 ||
    active[0] !== game.user
  )
    throw Error('Dedicated sole GM session required; close all other user sessions');
  if (game.combats.contents.length !== 0)
    throw Error('Existing encounters prevent isolated lifecycle validation');
  if (g.CONFIG.time.turnTime !== 0 || !Number.isFinite(g.CONFIG.time.roundTime))
    throw Error('Native turn-time zero prerequisite failed');
  const actors = [
    ...game.actors.contents,
    ...game.scenes.contents.flatMap((s: any) =>
      s.tokens.contents.map((t: any) => t.actor).filter(Boolean),
    ),
  ];
  if (
    actors.length > 5000 ||
    actors.some(
      (a: any) =>
        (a.effects?.size ?? 0) > 0 ||
        a.items?.contents.some(
          (i: any) =>
            ['effect', 'condition', 'affliction'].includes(i.type) || (i.effects?.size ?? 0) > 0,
        ),
    )
  )
    throw Error('Relevant world/synthetic actor lifecycle effects prevent isolated validation');
  const tracker = game.pf2e?.effectTracker;
  if (
    !tracker ||
    !Array.isArray(tracker.effects) ||
    tracker.effects.length !== 0 ||
    tracker.auraEffects?.size !== 0
  )
    throw Error('PF2e effect/aura tracker isolation is unavailable');
  if (g.ui.combat.viewed) throw Error('Original viewed encounter must be null');
  const anchor = game.settings.storage.get('world').getSetting('agent-gateway.auditJournalId');
  const selected = game.settings.get('agent-gateway', 'auditJournalId');
  const audit = game.journal.get(selected);
  if (
    anchor?.key !== 'agent-gateway.auditJournalId' ||
    anchor.user !== null ||
    anchor.value !== selected ||
    !game.users.get(anchor._stats?.lastModifiedBy)?.isGM ||
    !audit ||
    audit.flags?.['agent-gateway']?.auditJournal !== true ||
    audit.ownership.default !== 0 ||
    game.users.some((u: any) => !u.isGM && audit.getUserLevel(u) !== 0) ||
    !game.documentTypes.JournalEntryPage.includes('agent-gateway.audit')
  )
    throw Error('Trusted private audit journal prerequisite failed');
  const modules = game.modules.contents.filter((m: any) => m.active).map((m: any) => m.id);
  if (modules.some((id: string) => id !== 'agent-gateway'))
    throw Error('Additional active modules require reviewed lifecycle isolation');
  return {
    foundryVersion: game.version,
    systemVersion: game.system.version,
    gm: { id: game.user.id, name: game.user.name },
    worldTime: game.time.worldTime,
    turnTime: g.CONFIG.time.turnTime,
    roundTime: g.CONFIG.time.roundTime,
    activeScenes: game.scenes.contents.filter((s: any) => s.active).map((s: any) => s.uuid),
    view: {
      sceneId: g.canvas.scene?.id ?? null,
      levelId: g.canvas.level?.id ?? null,
      combatUuid: g.ui.combat.viewed?.uuid ?? null,
      targets: [...game.user.targets].map((t: any) => t.id),
    },
    roots: [...game.actors.contents, ...game.scenes.contents, ...game.combats.contents].map(
      (d: any) => d.uuid,
    ),
    audits: audit.pages.contents.map((p: any) => p.uuid),
    actorSources: game.actors.contents.map((a: any) => ({ uuid: a.uuid, source: a.toObject() })),
    sceneSources: game.scenes.contents.map((s: any) => ({ uuid: s.uuid, source: s.toObject() })),
    modules,
  };
}
