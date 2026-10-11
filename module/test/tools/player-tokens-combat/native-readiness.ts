/* eslint-disable @typescript-eslint/no-explicit-any */
/** Runs inside native Foundry. Reads/config-validates only; never creates/updates documents. */
export function readNativeReadiness({
  playerName,
  version,
  reportOnly = false,
}: {
  playerName: string;
  version: string;
  reportOnly?: boolean;
}) {
  const g = globalThis as any;
  const game = g.game;
  const players = game.users.filter((u: any) => u.name.toLowerCase() === playerName.toLowerCase());
  const player = players[0];
  const anchor = game.settings.storage.get('world').getSetting('agent-gateway.auditJournalId');
  let selected: unknown;
  let registeredCacheMatches = false;
  try {
    selected = game.settings.get('agent-gateway', 'auditJournalId');
    registeredCacheMatches = selected === anchor?.value;
  } catch {
    if (!reportOnly) throw Error('Actual proof requires registered audit settings');
    selected = anchor?.value;
  }
  const audit = typeof selected === 'string' ? game.journal.get(selected) : undefined;
  if (
    !game.user.isGM ||
    game.users.activeGM?.id !== game.user.id ||
    game.users.filter((u: any) => u.active && u.isGM).length !== 1 ||
    players.length !== 1 ||
    !player ||
    player.isGM ||
    game.world.id !== 'test-world' ||
    game.system.id !== 'pf2e' ||
    !game.version.startsWith(version.slice(1) + '.')
  )
    throw Error('Native identity/system isolation prerequisite failed');
  if (
    (!reportOnly && !registeredCacheMatches) ||
    !game.modules.get('agent-gateway')?.active ||
    !game.documentTypes.JournalEntryPage.includes('agent-gateway.audit') ||
    !audit ||
    audit.flags?.['agent-gateway']?.auditJournal !== true ||
    audit.ownership.default !== 0 ||
    anchor?.key !== 'agent-gateway.auditJournalId' ||
    anchor.user !== null ||
    anchor.value !== selected ||
    !game.users.get(anchor._stats?.lastModifiedBy)?.isGM
  )
    throw Error('Native audit prerequisites failed');
  if (game.users.some((u: any) => !u.isGM && audit.getUserLevel(u) !== 0))
    throw Error('Audit ACL is not private');
  if (g.CONFIG.time.turnTime !== 0 || !Number.isFinite(g.CONFIG.time.roundTime))
    throw Error('Fixture requires a zero-time within-round turn step');
  for (const type of ['Actor', 'Scene', 'Combat'])
    if (!g.CONFIG[type]?.documentClass) throw Error('Native document constructors unavailable');
  // Construction and validation are read-only: prove minimal PF2e fixture data before creating anything.
  const actor = new g.CONFIG.Actor.documentClass({
    name: 'Task22 validation',
    type: 'npc',
    system: {},
    ownership: { default: 0, [player.id]: 3 },
  });
  if (actor.validate() !== true) throw Error('Minimal PF2e NPC fixture is invalid');
  return {
    registeredCacheMatches,
    actualProofReady: registeredCacheMatches,
    gm: { id: game.user.id, name: game.user.name },
    player: { id: player.id, name: player.name },
    foundryVersion: game.version,
    moduleVersion: game.modules.get('agent-gateway')?.version,
    worldTime: game.time.worldTime,
    turnTime: g.CONFIG.time.turnTime,
    roundTime: g.CONFIG.time.roundTime,
  };
}
