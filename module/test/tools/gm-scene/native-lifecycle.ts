/* eslint-disable @typescript-eslint/no-explicit-any */
/** Shared fail-closed cleanup proof. A settled promise is insufficient without a terminal native decision. */
export function assertTask24Terminal(
  records: Array<{ terminal: boolean; approvalId?: string }>,
  queue: unknown,
) {
  if (!Array.isArray(queue)) throw Error('Native approval queue unavailable');
  if (
    queue.some(
      (row) => !row || row.status === 'pending' || (row.status === 'approved' && !row.result),
    )
  )
    throw Error('Pending/running native request requires manual reconciliation');
  for (const record of records) {
    const row = queue.find((r) => r.id === record.approvalId);
    if (
      !record.terminal ||
      !record.approvalId ||
      !row ||
      !['approved', 'denied', 'expired'].includes(row.status) ||
      (row.status === 'approved' && !row.result)
    )
      throw Error('Exact native execution terminality is unproven');
  }
}
export function assertTask24Decision(
  row: { status?: unknown; resolvedBy?: unknown; scope?: unknown } | undefined,
  gm: string,
  denied: boolean,
) {
  if (
    !row ||
    row.resolvedBy !== gm ||
    row.status !== (denied ? 'denied' : 'approved') ||
    (!denied && row.scope !== 'once')
  )
    throw Error('Exact human approval/denial was not proven');
}
/** Browser-safe standalone guard; refuse restoration when another change owns the active Scene. */
export function assertTask24Activation(input: {
  fixture: string;
  current: string[];
  saved: Array<{ uuid: string; source: unknown }>;
  currentSources: Array<{ uuid: string; source: unknown }>;
}) {
  if (JSON.stringify([...input.current].sort()) !== JSON.stringify([input.fixture]))
    throw Error('External activation: preserve changes for manual reconciliation');
  if (input.saved.length !== input.currentSources.length)
    throw Error('Original Scene collection changed');
  for (const saved of input.saved) {
    const current = input.currentSources.find((s) => s.uuid === saved.uuid);
    if (!current || JSON.stringify(current.source) !== JSON.stringify(saved.source))
      throw Error('Original Scene changed: preserve external changes');
  }
}
export function assertTask24Bundle(actual: string, expected: string) {
  if (actual !== expected || !/^[a-f0-9]{64}$/.test(actual))
    throw Error('Exact reviewed bundle mismatch');
}

/** Stored pairing and offline tool lists cannot establish an authenticated live executor. */
export function assertTask24Principal(
  expected: { worldId: string; userId: string; agentId: string },
  connection:
    | { worldId: string; userId: string; agentId: string; closed: boolean; info: { isGM: boolean } }
    | undefined,
  tools: readonly { name: string }[] | undefined,
) {
  if (
    !connection ||
    connection.closed ||
    !connection.info.isGM ||
    connection.worldId !== expected.worldId ||
    connection.userId !== expected.userId ||
    connection.agentId !== expected.agentId ||
    !tools ||
    ['token_manage', 'combat_manage', 'scene_control'].some(
      (name) => !tools.some((t) => t.name === name),
    )
  )
    throw Error('Authenticated live Task24 principal/tool announcement unavailable');
}

/** Self-contained browser callback; rechecks actual native GM identity across cleanup awaits. */
export async function task24RemoveFixtures({ roots, run, baseline, activationGuard }: any) {
  const g = globalThis as any;
  if (g.game.time.worldTime !== baseline.worldTime)
    throw Error('World time changed before cleanup');
  if (
    g.game.user?.id !== baseline.gm.id ||
    !g.game.user.isGM ||
    g.game.users.get(baseline.gm.id) !== g.game.user ||
    g.game.users.activeGM !== g.game.user ||
    g.game.users.contents.some((u: any) => u.active && u.isGM && u !== g.game.user)
  )
    throw Error('Cleanup GM authority/isolation changed');
  g.ui.combat.viewed = null;
  const scene = g.game.scenes.contents.find((s: any) => s.flags?.world?.task24 === run);
  const active = g.game.scenes.contents
    .filter((s: any) => s.active)
    .map((s: any) => s.uuid)
    .sort();
  if (scene?.active) {
    if (!activationGuard || JSON.stringify(active) !== JSON.stringify([scene.uuid]))
      throw Error('Unproven/external activation: manual reconciliation');
    for (const saved of activationGuard) {
      const current = await g.fromUuid(saved.uuid);
      if (!current || JSON.stringify(current.toObject()) !== JSON.stringify(saved.source))
        throw Error('Original Scene changed: preserve external changes');
    }
    if (baseline.activeScenes.length > 1) throw Error('Ambiguous original activation');
    if (baseline.activeScenes.length) {
      const old = await g.fromUuid(baseline.activeScenes[0]);
      if (!old) throw Error('Original scene missing');
      if (
        g.game.user?.id !== baseline.gm.id ||
        !g.game.user.isGM ||
        g.game.users.get(baseline.gm.id) !== g.game.user ||
        g.game.users.activeGM !== g.game.user ||
        g.game.users.contents.some((u: any) => u.active && u.isGM && u !== g.game.user)
      )
        throw Error('Cleanup GM authority/isolation changed');
      await old.update({ active: true });
      if (
        g.game.user?.id !== baseline.gm.id ||
        !g.game.user.isGM ||
        g.game.users.get(baseline.gm.id) !== g.game.user ||
        g.game.users.activeGM !== g.game.user ||
        g.game.users.contents.some((u: any) => u.active && u.isGM && u !== g.game.user)
      )
        throw Error('Cleanup GM authority/isolation changed');
    } else {
      if (
        g.game.user?.id !== baseline.gm.id ||
        !g.game.user.isGM ||
        g.game.users.get(baseline.gm.id) !== g.game.user ||
        g.game.users.activeGM !== g.game.user ||
        g.game.users.contents.some((u: any) => u.active && u.isGM && u !== g.game.user)
      )
        throw Error('Cleanup GM authority/isolation changed');
      await scene.update({ active: false });
      if (
        g.game.user?.id !== baseline.gm.id ||
        !g.game.user.isGM ||
        g.game.users.get(baseline.gm.id) !== g.game.user ||
        g.game.users.activeGM !== g.game.user ||
        g.game.users.contents.some((u: any) => u.active && u.isGM && u !== g.game.user)
      )
        throw Error('Cleanup GM authority/isolation changed');
    }
  }
  for (const uuid of [...roots].reverse()) {
    const d = await g.fromUuid(uuid);
    if (!d) continue;
    if (d.flags?.world?.task24 !== run || baseline.roots.includes(uuid))
      throw Error('Cleanup root identity mismatch');
    if (
      g.game.user?.id !== baseline.gm.id ||
      !g.game.user.isGM ||
      g.game.users.get(baseline.gm.id) !== g.game.user ||
      g.game.users.activeGM !== g.game.user ||
      g.game.users.contents.some((u: any) => u.active && u.isGM && u !== g.game.user)
    )
      throw Error('Cleanup GM authority/isolation changed');
    await d.delete();
    if (
      g.game.user?.id !== baseline.gm.id ||
      !g.game.user.isGM ||
      g.game.users.get(baseline.gm.id) !== g.game.user ||
      g.game.users.activeGM !== g.game.user ||
      g.game.users.contents.some((u: any) => u.active && u.isGM && u !== g.game.user)
    )
      throw Error('Cleanup GM authority/isolation changed');
  }
  if (
    g.game.user?.id !== baseline.gm.id ||
    !g.game.user.isGM ||
    g.game.users.get(baseline.gm.id) !== g.game.user ||
    g.game.users.activeGM !== g.game.user ||
    g.game.users.contents.some((u: any) => u.active && u.isGM && u !== g.game.user)
  )
    throw Error('Cleanup GM authority/isolation changed');
  if (baseline.view.sceneId) {
    const old = g.game.scenes.get(baseline.view.sceneId);
    await old.view(baseline.view.levelId ? { level: baseline.view.levelId } : {});
  } else await g.canvas.draw(null);
  if (
    g.game.user?.id !== baseline.gm.id ||
    !g.game.user.isGM ||
    g.game.users.get(baseline.gm.id) !== g.game.user ||
    g.game.users.activeGM !== g.game.user ||
    g.game.users.contents.some((u: any) => u.active && u.isGM && u !== g.game.user)
  )
    throw Error('Cleanup GM authority/isolation changed');
  g.canvas.tokens.setTargets(baseline.view.targets, { mode: 'replace' });
  g.ui.combat.viewed = null;
}
