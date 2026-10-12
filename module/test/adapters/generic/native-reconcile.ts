/* eslint-disable @typescript-eslint/no-explicit-any */
/** Read-only callback: recover exact persisted evidence after the original owned browser closed. */
export function task31Reconcile(input: any) {
  const g: any = globalThis,
    game = g.game,
    b = input.baseline;
  const helpers = {
    source(d: any, audit = false) {
      const v = d.toObject();
      if (audit) {
        delete v.pages;
        delete v._stats;
      }
      const s = JSON.stringify(v);
      if (s.length > 1048576) throw Error('Bounded source required');
      return s;
    },
  };
  if (
    !game.ready ||
    game.world.id !== 'test-world' ||
    Number(game.release.generation) !== input.generation ||
    !game.user?.isGM ||
    game.user.id !== b.gm.id ||
    game.user.name !== b.gm.name ||
    game.users.get(game.user.id) !== game.user ||
    game.users.activeGM !== game.user ||
    game.users.filter((u: any) => u.active && u.isGM).length !== 1 ||
    game.time.worldTime !== b.worldTime
  )
    throw Error('Exact canonical GM/world/time required');
  const audit = game.journal.get(b.auditId),
    storage = game.settings.storage.get('world');
  if (
    !audit ||
    game.settings.get('agent-gateway', 'auditJournalId') !== audit.id ||
    !audit.flags['agent-gateway']?.auditJournal ||
    game.actors.get(input.created.uuid.slice(6))
  )
    throw Error('Exact audit or fixture absence mismatch');
  const settings = storage.contents
    .map((d: any) => ({ id: d.id, source: helpers.source(d) }))
    .sort((a: any, b: any) => a.id.localeCompare(b.id));
  if (JSON.stringify(settings) !== JSON.stringify(b.settings))
    throw Error('Original settings changed');
  for (const [key, expected] of Object.entries(b.roots))
    if (
      JSON.stringify(game[key].contents.map((d: any) => d.uuid).sort()) !== JSON.stringify(expected)
    )
      throw Error('Original roots changed');
  for (const saved of b.sources) {
    const d = game[saved.collection].get(saved.id);
    if (
      !d ||
      helpers.source(d, saved.collection === 'journal' && saved.id === audit.id) !== saved.source
    )
      throw Error('Original source changed');
  }
  for (const saved of b.auditPages) {
    const d = audit.pages.get(saved.id);
    if (!d || helpers.source(d) !== saved.source) throw Error('Original audit changed');
  }
  const views = {
    scene: g.canvas.scene?.id ?? null,
    level: g.canvas.level?.id ?? null,
    targets: [...game.user.targets].map((t: any) => t.id).sort(),
    combat: g.ui.combat?.viewed?.uuid ?? null,
    active: game.scenes.contents
      .filter((s: any) => s.active)
      .map((s: any) => s.id)
      .sort(),
  };
  if (
    JSON.stringify(views) !== JSON.stringify(b.views) ||
    JSON.stringify(game.settings.get('agent-gateway', 'ownerPolicy') ?? null) !== b.ownerPolicy
  )
    throw Error('Original views/owner policy changed');
  const raw = localStorage.getItem(`agent-gateway.${game.world.id}.approvalQueue`);
  if (!raw || raw.length > 1048576) throw Error('Bounded approval evidence required');
  const queue = JSON.parse(raw)[game.user.id];
  if (
    !Array.isArray(queue) ||
    queue.some((r: any) => r.status === 'pending' || (r.status === 'approved' && !r.result))
  )
    throw Error('Unsettled native approval');
  const records = input.ids.map((id: string) => {
    const rows = queue.filter((r: any) => r.id === id);
    if (rows.length !== 1) throw Error('Unique persisted approval required');
    return rows[0];
  });
  const rows = audit.pages.contents
    .filter((p: any) => !b.auditPages.some((s: any) => s.id === p.id))
    .map((p: any) => ({ uuid: p.uuid, ...p.system.toObject() }));
  if (rows.length !== 2) throw Error('Exact two saved audits required');
  return {
    records,
    rows,
    fixtureAbsent: true,
    originalSourcesUnchanged: true,
    settingsViewsTimeUnchanged: true,
    systemVersion: game.system.version,
    foundryVersion: game.version,
  };
}
