/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  decodeDataPath,
  imageAssign,
  isImagePath,
  normalizeDataPath,
  type ImageAssignOutput,
} from '@agent-gateway/protocol';
import { foundryGeneration, fromUuidCompat } from '../compat/index.js';
import type { DispatchResult, OpHandler } from '../ops/types.js';
import { WriteError, defineWriteHandler, forbid, invalid, owns, trustedUser } from './_write.js';
import { folderAllowed } from '../policy/folders.js';
import { actionFields } from './_scene.js';
import { browseImages } from './_image.js';

declare const game: any;

type Args = ReturnType<typeof imageAssign.input.parse>;
const DEFAULT_LIMIT = 100;
const GM_ONLY = new Set(['scene_background', 'tile']);

const hasBrowse = (user: any): boolean => user.isGM === true || user.can?.('FILES_BROWSE') === true;

/** The path must be a valid image path that a browse of its parent directory lists. */
async function verifiedPath(user: any, input: string): Promise<string> {
  const norm = normalizeDataPath(input);
  if (!norm.ok) return invalid(`Invalid image path (${norm.code})`);
  if (!isImagePath(norm.path)) return invalid('The path is not a supported image file');
  const slash = norm.path.lastIndexOf('/');
  const parent = slash < 0 ? '' : norm.path.slice(0, slash);
  const listing = await browseImages(user, parent, 200);
  const wanted = decodeDataPath(norm.path);
  const found = listing.files.find((f) => decodeDataPath(f.path) === wanted);
  if (!found)
    return invalid(
      listing.truncated
        ? 'The directory is too large to confirm the image exists'
        : 'The image does not exist in its directory',
    );
  // Foundry's own string is canonical; write exactly that.
  return found.path;
}

const ROOTS: Record<string, string> = { Actor: 'actors', Scene: 'scenes' };
const CHILDREN: Record<string, string> = { Token: 'tokens', Tile: 'tiles' };

/** A document held by a native world collection (or a world Scene's embedded collection). */
function worldDoc(doc: any): boolean {
  if (!doc || doc.pack || typeof doc.id !== 'string') return false;
  const name = doc.documentName;
  if (Object.hasOwn(ROOTS, name))
    return (
      !doc.parent && game[ROOTS[name]!]?.get?.(doc.id) === doc && doc.uuid === `${name}.${doc.id}`
    );
  const parent = doc.parent;
  return (
    Object.hasOwn(CHILDREN, name) &&
    worldDoc(parent) &&
    parent.documentName === 'Scene' &&
    parent[CHILDREN[name]!]?.get?.(doc.id) === doc &&
    doc.uuid === `${parent.uuid}.${name}.${doc.id}`
  );
}

async function resolveTarget(user: any, target: NonNullable<Args['target']>, uuid: string) {
  const doc = await fromUuidCompat(uuid);
  const expect = (name: string): void => {
    if (!doc || doc.documentName !== name) invalid(`The uuid is not a ${name} (target ${target})`);
    // Embedded documents follow their root; an excluded one answers like a missing uuid.
    const root = name === 'Token' || name === 'Tile' ? doc.parent : doc;
    if (!folderAllowed(root, user.isGM === true))
      invalid(`The uuid is not a ${name} (target ${target})`);
  };
  if (target === 'actor_portrait' || target === 'actor_token') {
    expect('Actor');
    if (!worldDoc(doc) || doc.uuid !== uuid) forbid('A world Actor is required');
  } else if (target === 'token' || target === 'tile') {
    expect(target === 'token' ? 'Token' : 'Tile');
    if (!worldDoc(doc) || doc.uuid !== uuid)
      forbid('A placed document in a world Scene is required');
  } else {
    expect('Scene');
    if (!worldDoc(doc) || doc.uuid !== uuid) forbid('A world Scene is required');
  }
  if (user.isGM !== true && !owns(doc, user)) forbid('You do not own that document');
  if (doc.canUserModify?.(user, 'update') === false) forbid('You may not update that document');
  return doc;
}

/** v14 stores a scene background on its Level; v13 on the Scene itself. */
function sceneLevel(scene: any): any {
  const levels = scene.levels;
  const level =
    scene.initialLevel ??
    levels?.get?.('defaultLevel0000') ??
    (levels?.size === 1 ? levels.contents[0] : null);
  if (!level) invalid('The scene has no level to hold a background');
  return level;
}

const permissionText = /permission|lacks|not allowed|forbidden/i;

const setHandler = defineWriteHandler({
  targets: () => [],
  async run(ctx) {
    const args = imageAssign.input.parse(ctx.args);
    actionFields(args, ['path', 'target', 'uuid']);
    const user = trustedUser(ctx);
    if (!hasBrowse(user)) forbid('Assigning an image requires the FILES_BROWSE permission');
    const target = args.target!;
    if (GM_ONLY.has(target) && user.isGM !== true) forbid(`${target} is for the GM only`);
    const path = await verifiedPath(user, args.path!);
    const doc = await resolveTarget(user, target, args.uuid!);

    let holder = doc;
    let update: Record<string, unknown>;
    let read: () => unknown;
    if (target === 'actor_portrait') {
      update = { img: path };
      read = () => doc.img;
    } else if (target === 'actor_token') {
      update = { 'prototypeToken.texture.src': path };
      read = () => doc.prototypeToken?.texture?.src;
    } else if (target === 'scene_background' && foundryGeneration() >= 14) {
      holder = sceneLevel(doc);
      update = { _id: holder.id, 'background.src': path };
      read = () => doc.background?.src;
    } else if (target === 'scene_background') {
      update = { 'background.src': path };
      read = () => doc.background?.src;
    } else {
      update = { 'texture.src': path };
      read = () => doc.texture?.src;
    }

    await ctx.snapshot(holder.uuid);
    try {
      if (holder !== doc) await doc.updateEmbeddedDocuments('Level', [update], ctx.callOptions);
      else await doc.update(update, ctx.callOptions);
    } catch (error) {
      if (error instanceof WriteError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (permissionText.test(message)) return forbid(message);
      throw error;
    }
    if (read() !== path) throw new Error('Foundry did not store the requested image path');
    const structured: ImageAssignOutput = { path, target, uuid: doc.uuid };
    return {
      text: `Image set: ${decodeDataPath(path) ?? path} on ${target} ${doc.uuid}`,
      structured,
    } satisfies DispatchResult;
  },
});

export const imageAssignHandler: OpHandler = async (ctx) => {
  const args = imageAssign.input.parse(ctx.args);
  if (args.action === 'set') return setHandler(ctx);
  try {
    actionFields(args, [], ['dir', 'limit']);
    const user = trustedUser(ctx);
    const r = await browseImages(user, args.dir, args.limit ?? DEFAULT_LIMIT);
    const structured: ImageAssignOutput = { dirs: r.dirs, files: r.files, truncated: r.truncated };
    return {
      text: `${r.dirs.length} directories, ${r.files.length} images in "${r.dir}"${r.truncated ? ' (truncated)' : ''}`,
      structured,
    };
  } catch (error) {
    if (error instanceof WriteError) return { error: { code: error.code, message: error.message } };
    throw error;
  }
};
imageAssignHandler.prepare = (ctx) => {
  if ((ctx.args as { action?: unknown }).action === 'set') ctx.escalate!('write');
};
