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
