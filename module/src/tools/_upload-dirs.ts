/* eslint-disable @typescript-eslint/no-explicit-any */
import { resolveFilePicker } from './_image.js';
import { forbid, invalid } from './_write.js';

declare const game: any;
declare const Hooks: any;

const USER_ID = /^[A-Za-z0-9]{1,32}$/;
const ASSISTANT_FALLBACK = 3;

/** The three fixed directory levels for one uploader. The id is a Foundry user id, never caller text. */
export function uploadLevels(userId: string): string[] {
  return ['agent-gateway', 'agent-gateway/uploads', `agent-gateway/uploads/${userId}`];
}

/** Foundry lets only Assistant+ (or a GM) call createDirectory, before it checks existence. */
export function canCreateDirectories(user: any): boolean {
  if (user?.isGM === true) return true;
  const assistant = (globalThis as any).CONST?.USER_ROLES?.ASSISTANT ?? ASSISTANT_FALLBACK;
  return Number(user?.role) >= assistant;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Browses each level and creates only the missing ones, and only when the user is allowed to. */
export async function ensureUploadDirs(fp: any, user: any, userId: string): Promise<string> {
  const levels = uploadLevels(userId);
  for (const level of levels) {
    try {
      await fp.browse('data', level);
      continue;
    } catch {
      /* missing (or not listable): fall through to creation */
    }
    if (!canCreateDirectories(user))
      forbid(
        `The upload folder ${level} does not exist. A GM must create it, or a GM must load the world so it is created automatically.`,
      );
    try {
      await fp.createDirectory('data', level);
    } catch (error) {
      const text = message(error);
      if (/EEXIST|already exists/i.test(text)) continue;
      if (/permission/i.test(text)) forbid(text);
      invalid(`Cannot prepare the upload directory: ${text}`);
    }
  }
  return levels[2]!;
}

const isActiveGm = (): boolean =>
  game?.user?.isGM === true && game.users?.activeGM?.id === game.user.id;

let chain: Promise<void> = Promise.resolve();

async function provisionAll(): Promise<void> {
  if (!isActiveGm()) return;
  const fp = resolveFilePicker();
  const users: any[] = Array.isArray(game.users?.contents)
    ? game.users.contents
    : [...(game.users ?? [])];
  for (const user of users) {
    if (!isActiveGm()) return;
    const id = user?.id;
    if (typeof id !== 'string' || !USER_ID.test(id)) continue;
    if (user.can?.('FILES_UPLOAD') !== true) continue;
    try {
      await ensureUploadDirs(fp, game.user, id);
    } catch (error) {
      console.warn(`agent-gateway | cannot provision the upload folder: ${message(error)}`);
    }
  }
}

/** Runs are serialised; every error is logged, nothing is thrown into a hook. */
function trigger(): void {
  chain = chain
    .then(() => provisionAll())
    .catch((error) => {
      console.warn(`agent-gateway | upload provisioning failed: ${message(error)}`);
    });
}

/** Registers the GM-side hooks that create each uploader's folder. Call once, from `ready`. */
export function installUploadProvisioning(): void {
  const permissions = (setting: any): void => {
    if (setting?.key === 'core.permissions') trigger();
  };
  Hooks.on('updateUser', trigger);
  Hooks.on('createUser', trigger);
  Hooks.on('createSetting', permissions);
  Hooks.on('updateSetting', permissions);
  trigger();
}

/** Test seam: resolves when queued runs have finished. */
export function provisioningIdle(): Promise<void> {
  return chain;
}
