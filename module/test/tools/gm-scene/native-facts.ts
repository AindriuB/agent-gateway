/* eslint-disable @typescript-eslint/no-explicit-any */
/** Read-only native postconditions: the executor must call this after each terminal step. */
export async function task24StepFacts(input: {
  index: number;
  ids: {
    scene: string;
    actor: string;
    combat: string;
    tokens: string[];
    combatants: string[];
    level: string;
  };
  baseline: { worldTime: number; activeScenes: string[] };
  generation: 13 | 14;
}) {
  const g = globalThis as any,
    { ids, index, baseline } = input;
  const scene = await g.fromUuid(ids.scene),
    combat = await g.fromUuid(ids.combat);
  const active = g.game.scenes.contents
    .filter((s: any) => s.active)
    .map((s: any) => s.uuid)
    .sort();
  if (g.game.time.worldTime !== baseline.worldTime)
    throw Error('World time changed during native step');
  if (
    index === 0 &&
    (JSON.stringify(active) !== JSON.stringify([...baseline.activeScenes].sort()) ||
      g.canvas.scene !== scene)
  )
    throw Error('Local view changed global activation or did not view fixture');
  if (index >= 1 && JSON.stringify(active) !== JSON.stringify([ids.scene]))
    throw Error('Global activation is not exactly the fixture');
  if (index >= 2 && scene.environment.darknessLevel !== 0.25)
    throw Error('Darkness did not persist');
  if (
    index === 3 &&
    input.generation === 14 &&
    (g.canvas.scene !== scene || g.canvas.level?.id !== ids.level)
  )
    throw Error('Native level view did not persist');
  if (index === 4 || index === 5) {
    const token = await g.fromUuid(ids.tokens[index - 4]);
    const position =
      index === 4 ? { x: 100, y: 100, rotation: 90 } : { x: 400, y: 100, rotation: 0 };
    const size = token?.getSize(),
      r = scene.dimensions.sceneRect;
    if (
      !token ||
      token.parent !== scene ||
      token.actorId !== ids.actor.split('.')[1] ||
      token.x !== position.x ||
      token.y !== position.y ||
      token.rotation !== position.rotation ||
      token.hidden !== false ||
      !size ||
      token.x < r.x ||
      token.y < r.y ||
      token.x + size.width > r.x + r.width ||
      token.y + size.height > r.y + r.height
    )
      throw Error('Native placement facts mismatch');
  }
  if (index >= 6 && index <= 13) {
    const token = await g.fromUuid(ids.tokens[0]);
    if (!token || token.hidden !== true) throw Error('Hidden/retained token facts mismatch');
  }
  if (index >= 7 && index <= 12) {
    if (!combat || combat.combatants.size !== 2 || combat.scene !== scene)
      throw Error('Encounter identity mismatch');
    for (let i = 0; i < 2; i++) {
      const row = await g.fromUuid(ids.combatants[i]);
      if (
        !row ||
        row.parent !== combat ||
        row.tokenId !== ids.tokens[i]!.split('.').at(-1) ||
        row.sceneId !== scene.id ||
        row.actorId !== ids.actor.split('.')[1]
      )
        throw Error('Combatant identity mismatch');
    }
  }
  if (index === 10 && (combat.round !== 1 || combat.turn !== 0))
    throw Error('Start state mismatch');
  if ((index === 11 || index === 12) && (combat.round !== 1 || combat.turn !== 1))
    throw Error('Next turn or denied end state mismatch');
  if (index >= 13)
    for (const uuid of [ids.combat, ...ids.combatants])
      if (await g.fromUuid(uuid)) throw Error('Ended encounter remains');
  if (index >= 14 && (await g.fromUuid(ids.tokens[0]))) throw Error('First removed token remains');
  if (index >= 15 && (await g.fromUuid(ids.tokens[1]))) throw Error('Second removed token remains');
  return {
    index: index + 1,
    worldTimeUnchanged: true,
    activeScenes: active,
    round: combat?.round ?? null,
    turn: combat?.turn ?? null,
  };
}
