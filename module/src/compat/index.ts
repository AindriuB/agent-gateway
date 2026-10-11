/**
 * The only module code allowed to branch on Foundry generation or probe
 * v14-only features. Everything else imports from here.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const game: any;
declare const foundry: any;
declare function fromUuid(uuid: string, options?: object): Promise<any>;

export type FoundryGeneration = 13 | 14;

export function foundryGeneration(): FoundryGeneration {
  const gen = Number(game.release?.generation);
  return gen >= 14 ? 14 : 13;
}

/** True only on v14+ when Scene Levels are present. */
export function hasSceneLevels(): boolean {
  if (foundryGeneration() < 14) return false;
  return typeof foundry?.documents?.BaseLevel === 'function';
}

export function getApplicationV2(): any {
  return foundry.applications.api.ApplicationV2;
}

export function getHandlebarsApplicationMixin(): any {
  return foundry.applications.api.HandlebarsApplicationMixin;
}

export function fromUuidCompat(uuid: string, options?: object): Promise<any> {
  return fromUuid(uuid, options);
}

/** Shared native movement entry point; both generations retain their own constraints/lifecycle. */
export async function moveTokenCompat(
  token: any,
  waypoints: readonly { x: number; y: number }[],
  callOptions: object,
): Promise<boolean> {
  if (typeof token?.move !== 'function') throw new Error('Native token movement is unavailable');
  const completed = await token.move(
    waypoints.map(({ x, y }) => ({ x, y })),
    callOptions,
  );
  if (typeof completed !== 'boolean')
    throw new Error('Native movement returned no completion result');
  // v13 returns whether any movement occurred, including a path shortened by walls/cost.
  // Its post-update state distinguishes that from actually completing the movement.
  // v14 already returns destination completion from Scene.moveTokens.
  return foundryGeneration() === 13
    ? completed && token.movement?.state === 'completed'
    : completed;
}

declare const Hooks: any;
declare const ui: any;
/**
 * Native nextTurn/nextRound do not forward options. Preserve their bounded algorithm while
 * performing one normal audited update, including system hooks and native world-time handling.
 */
export async function advanceCombatCompat(
  combat: any,
  callOptions: object,
  checkImmediatelyBeforeUpdate: () => void,
): Promise<void> {
  const turns = combat.turns;
  const round = combat.round;
  const turn = combat.turn;
  if (
    !Array.isArray(turns) ||
    turns.length < 1 ||
    turns.length > 1000 ||
    !Number.isSafeInteger(round) ||
    round < 1 ||
    round >= 1000000 ||
    !Number.isSafeInteger(turn) ||
    turn < 0 ||
    turn >= turns.length ||
    typeof combat.getTimeDelta !== 'function' ||
    typeof combat.update !== 'function'
  )
    throw new Error('Unsupported current combat state');
  let next: number | null = null;
  if (combat.settings?.skipDefeated === true) {
    for (let i = turn + 1; i < turns.length; i++) {
      if (!turns[i].isDefeated) {
        next = i;
        break;
      }
    }
  } else next = turn + 1;
  let nextRound = round;
  const wrap = next === null || next >= turns.length;
  if (wrap) {
    nextRound++;
    next = 0;
    if (combat.settings?.skipDefeated === true) {
      next = turns.findIndex((c: any) => !c.isDefeated);
      if (next === -1) {
        ui.notifications.warn('COMBAT.NoneRemaining', { localize: true });
        next = 0;
      }
    }
  }
  const delta = combat.getTimeDelta(round, turn, nextRound, next);
  if (!Number.isFinite(delta) || Math.abs(delta) > Number.MAX_SAFE_INTEGER)
    throw new Error('Unsupported combat time delta');
  const data = { round: nextRound, turn: next };
  const originalCallId = (callOptions as any).agentGateway?.callId;
  if (typeof originalCallId !== 'string' || !originalCallId)
    throw new Error('Audit correlation is unavailable');
  const options = {
    ...callOptions,
    agentGateway: { callId: originalCallId },
    direction: 1,
    worldTime: { delta },
  };
  Hooks.callAll(wrap ? 'combatRound' : 'combatTurn', combat, data, options);
  // Hooks may run arbitrary system code synchronously. Check caller/turn/ownership afterwards.
  if (
    !Number.isSafeInteger(data.round) ||
    data.round < 1 ||
    data.round > 1000000 ||
    typeof data.turn !== 'number' ||
    !Number.isSafeInteger(data.turn) ||
    data.turn < 0 ||
    data.turn >= turns.length ||
    !Number.isFinite(options.worldTime?.delta) ||
    Math.abs(options.worldTime.delta) > Number.MAX_SAFE_INTEGER
  )
    throw new Error('Native combat hook produced invalid update values');
  checkImmediatelyBeforeUpdate();
  const updated = await combat.update(data, {
    ...options,
    ...callOptions,
    agentGateway: { callId: originalCallId },
  });
  if (updated !== combat || combat.round !== data.round || combat.turn !== data.turn)
    throw new Error('Combat turn update was cancelled or did not persist');
}

/** Audited equivalent of native bounded encounter progression; native convenience methods drop options. */
export async function manageCombatProgressCompat(
  combat: any,
  action: 'start' | 'next_turn' | 'previous_turn' | 'next_round',
  callOptions: any,
  validate: () => void,
  afterUpdate: () => void = () => {},
): Promise<number> {
  const turns = combat.turns;
  const round = combat.round;
  const turn = combat.turn;
  if (
    !Array.isArray(turns) ||
    turns.length > 1000 ||
    !Number.isSafeInteger(round) ||
    round < 0 ||
    round >= 1000000 ||
    (turn !== null && (!Number.isSafeInteger(turn) || turn < 0 || turn >= turns.length))
  )
    throw new Error('Unsupported native encounter state');
  let nextRound = round,
    nextTurn: number | null = turn,
    hook = 'combatTurn',
    direction = 1;
  const roundForward = () => {
    hook = 'combatRound';
    nextRound = round + 1;
    nextTurn = turn === null || !turns.length ? null : 0;
    if (combat.settings?.skipDefeated && nextTurn !== null) {
      nextTurn = turns.findIndex((c: any) => !c.isDefeated);
      if (nextTurn === -1) {
        ui.notifications.warn('COMBAT.NoneRemaining', { localize: true });
        nextTurn = 0;
      }
    }
  };
  const roundBack = () => {
    hook = 'combatRound';
    direction = -1;
    nextRound = round - 1;
    nextTurn = round === 1 || turn === null || !turns.length ? null : turns.length - 1;
  };
  if (action === 'start') {
    hook = 'combatStart';
    nextRound = 1;
    nextTurn = 0;
    if (!turns.length) throw new Error('Cannot start an empty encounter');
  } else if (action === 'next_round' || (action === 'next_turn' && round === 0)) roundForward();
  else if (action === 'next_turn') {
    nextTurn = combat.settings?.skipDefeated
      ? turns.findIndex((c: any, i: number) => i > (turn ?? -1) && !c.isDefeated)
      : (turn ?? -1) + 1;
    if (nextTurn === null || nextTurn < 0 || nextTurn >= turns.length) roundForward();
  } else {
    direction = -1;
    if (round === 0) throw new Error('Encounter has no previous turn');
    if (turn === 0 || !turns.length) roundBack();
    else nextTurn = (turn ?? turns.length) - 1;
  }
  const delta = action === 'start' ? 0 : combat.getTimeDelta(round, turn, nextRound, nextTurn);
  const callId = callOptions.agentGateway?.callId;
  if (
    typeof callId !== 'string' ||
    !callId ||
    !Number.isFinite(delta) ||
    Math.abs(delta) > Number.MAX_SAFE_INTEGER
  )
    throw new Error('Invalid audit correlation or encounter time');
  const data = { round: nextRound, turn: nextTurn };
  const options: any = {
    ...callOptions,
    agentGateway: { callId },
    direction,
    worldTime: { delta },
  };
  validate();
  if (action === 'start') combat._playCombatSound('startEncounter');
  Hooks.callAll(hook, combat, data, ...(action === 'start' ? [] : [options]));
  if (
    !Number.isSafeInteger(data.round) ||
    data.round < 0 ||
    data.round > 1000000 ||
    (data.turn !== null &&
      (!Number.isSafeInteger(data.turn) || data.turn < 0 || data.turn >= turns.length)) ||
    !Number.isFinite(options.worldTime?.delta) ||
    Math.abs(options.worldTime.delta) > Number.MAX_SAFE_INTEGER
  )
    throw new Error('Native combat hook produced invalid progression');
  validate();
  const result = await combat.update(data, { ...options, agentGateway: { callId } });
  if (result !== combat || combat.round !== data.round || combat.turn !== data.turn)
    throw new Error('Native progression was cancelled or did not persist');
  afterUpdate();
  if (action === 'start' && foundryGeneration() >= 14) {
    afterUpdate();
    await foundry.documents.ActiveEffect.registry.refresh('combatStart', { combat });
    afterUpdate();
    if (combat.round !== data.round || combat.turn !== data.turn)
      throw new Error('Encounter changed during start refresh');
  }
  return options.worldTime.delta;
}

/** Local view only; never call activate as a fallback. */
export async function viewSceneCompat(scene: any, level?: any): Promise<void> {
  if (level && !hasSceneLevels()) throw new Error('requires Foundry v14 Scene Levels');
  const viewed = await scene.view(level ? { level: level.id } : {});
  if (viewed !== scene) throw new Error('Native scene view was refused');
  const canvas = (globalThis as any).canvas;
  if (canvas?.ready !== true || canvas.scene !== scene || (level && canvas.level?.id !== level.id))
    throw new Error('Native scene view did not complete');
}

/** Only exact native methods are supported; system preparation callbacks are excluded. */
export function supportsCoreInitiativeCompat(combatant: any): boolean {
  if (game.system?.id === 'pf2e') return false;
  const cls = foundry.documents.Combatant;
  return (
    game.system?.id !== 'pf2e' &&
    typeof cls?.prototype?.getInitiativeRoll === 'function' &&
    combatant.getInitiativeRoll === cls.prototype.getInitiativeRoll &&
    combatant._getInitiativeFormula === cls.prototype._getInitiativeFormula &&
    (!combatant.actor ||
      combatant.actor.getRollData === foundry.documents.Actor?.prototype?.getRollData)
  );
}
export async function prepareCoreInitiativeCompat(combatant: any): Promise<any> {
  if (!supportsCoreInitiativeCompat(combatant))
    throw new Error('Initiative automation is unsupported for this system adapter');
  const roll = combatant.getInitiativeRoll();
  if (!roll || typeof roll.evaluate !== 'function')
    throw new Error('Native initiative roll is unavailable');
  checkNativeInitiativeFormula(roll.formula);
  await roll.evaluate();
  if (!Number.isFinite(roll.total) || Math.abs(roll.total) > Number.MAX_SAFE_INTEGER)
    throw new Error('Native initiative total is invalid');
  return roll;
}

/** Conservative finite native formula subset, with no modifiers or repeat/explosion operators. */
export function checkNativeInitiativeFormula(formula: unknown): void {
  if (typeof formula !== 'string' || formula.length > 200)
    throw new Error('Unsupported bounded initiative formula');
  const flat = formula.replace(/\s/g, '');
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\d*[dD]\d+)(?:[+-](?:\d+(?:\.\d+)?|\d*[dD]\d+))*$/.test(flat))
    throw new Error('Unsupported bounded initiative formula');
  const terms = flat.match(/(?:\d*[dD]\d+|\d+(?:\.\d+)?)/g)!;
  let dice = 0;
  if (terms.length > 32) throw new Error('Initiative formula exceeds term bounds');
  for (const term of terms) {
    if (/[dD]/.test(term)) {
      const [n, s] = term.toLowerCase().split('d');
      const count = n ? Number(n) : 1,
        sides = Number(s);
      if (
        !Number.isSafeInteger(count) ||
        count < 1 ||
        (dice += count) > 100 ||
        !Number.isSafeInteger(sides) ||
        sides < 2 ||
        sides > 1000
      )
        throw new Error('Initiative dice exceed bounds');
    } else if (!Number.isFinite(Number(term)) || Number(term) > 1000000)
      throw new Error('Initiative number exceeds bounds');
  }
}
