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
  return completed;
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
