/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  IMAGE_UPLOAD_MAX_BYTES,
  IMAGE_UPLOAD_USER_QUOTA_BYTES,
  imageUpload,
  normalizeDataPath,
  sniffImage,
} from '@agent-gateway/protocol';
import { isAuditDocument } from '../audit/guard.js';
import { foundryGeneration } from '../compat/index.js';
import { decodeBase64Strict, sha256Bytes } from '../ops/redact.js';
import { resolveFilePicker } from './_image.js';
import { defineWriteHandler, forbid, invalid, owns, trustedUser, WriteError } from './_write.js';

declare const fromUuid: (uuid: string) => Promise<any>;
declare const globalThis: any;

const USER_ID = /^[A-Za-z0-9]{1,32}$/;
const EXTENSION = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const;
const ROOT = 'agent-gateway/uploads';

export function decodeBase64(data: string): Uint8Array {
  return decodeBase64Strict(data) ?? invalid('data is not valid base64');
}

/** Server-generated name: random id, decoded size (so the quota needs no stat call), derived extension. */
function serverName(bytes: number, mime: keyof typeof EXTENSION): string {
  const id = [...(globalThis.crypto.getRandomValues(new Uint8Array(12)) as Uint8Array)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${id}-${bytes}.${EXTENSION[mime]}`;
}

async function ensureDirectories(fp: any, userId: string): Promise<string> {
  const levels = ['agent-gateway', 'agent-gateway/uploads', `${ROOT}/${userId}`];
  for (const level of levels) {
    try {
      await fp.createDirectory('data', level);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/EEXIST|already exists/i.test(message)) continue;
      if (/permission/i.test(message)) forbid(message);
      invalid(`Cannot prepare the upload directory: ${message}`);
    }
  }
  return levels[2]!;
}

async function usedBytes(fp: any, dir: string): Promise<number> {
  let listing: any;
  try {
    listing = await fp.browse('data', dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return forbid(`The upload directory cannot be listed to enforce the quota: ${message}`);
  }
  let total = 0;
  for (const file of Array.isArray(listing?.files) ? listing.files : []) {
    const m = /-(\d{1,9})\.(?:png|jpg|webp)$/.exec(String(file));
    total += m ? Number(m[1]) : IMAGE_UPLOAD_MAX_BYTES;
  }
  return total;
}

async function resolveActor(user: any, uuid: string): Promise<any> {
  const actor = await fromUuid(uuid);
  if (
    actor?.documentName !== 'Actor' ||
    actor.pack ||
    actor.uuid !== uuid ||
    isAuditDocument(actor) ||
    (!user.isGM && !owns(actor, user))
  )
    forbid();
  return actor;
}

async function resolveScene(uuid: string): Promise<any> {
  const scene = await fromUuid(uuid);
  if (scene?.documentName !== 'Scene' || scene.pack || scene.uuid !== uuid) forbid();
  return scene;
}

function firstLevelId(scene: any): string {
  const levels = scene.levels;
  const list: any[] = Array.isArray(levels?.contents) ? levels.contents : levels ? [...levels] : [];
  const id = list[0]?.id ?? list[0]?._id;
  if (typeof id !== 'string' || !id) return invalid('The Scene has no level to update');
  return id;
}

export const imageUploadHandler = defineWriteHandler({
  targets: () => [],
  async run(ctx) {
    const args = imageUpload.input.parse(ctx.args);
    const user = trustedUser(ctx);

    // Argument shape and image validation come first: nothing is touched on a bad call.
    if (args.actorUuid ? !args.setPortrait && !args.setToken : args.setPortrait || args.setToken)
      invalid('actorUuid needs setPortrait or setToken, and each of them needs actorUuid');
    if (args.sceneUuid ? !args.setBackground : args.setBackground)
      invalid('sceneUuid and setBackground must be given together');
    const bytes = decodeBase64(args.data);
    if (bytes.length === 0 || bytes.length > IMAGE_UPLOAD_MAX_BYTES)
      invalid(`The decoded image must be 1 to ${IMAGE_UPLOAD_MAX_BYTES} bytes`);
    if (sniffImage(bytes) !== args.mime)
      invalid('The image bytes do not match the declared PNG, JPEG or WebP type');

    // Permissions. Identity is the server-set user only.
    if (!user.isGM && user.can?.('FILES_UPLOAD') !== true)
      forbid('Uploading files requires the FILES_UPLOAD permission');
    if (!user.isGM && user.can?.('FILES_BROWSE') !== true)
      forbid('Uploading files requires the FILES_BROWSE permission to enforce the upload quota');
    if (!user.isGM && args.sceneUuid) forbid('Only a GM may set a Scene background');
    if (!USER_ID.test(String(user.id))) invalid('The current user id cannot name a directory');

    const actor = args.actorUuid ? await resolveActor(user, args.actorUuid) : undefined;
    const scene = args.sceneUuid ? await resolveScene(args.sceneUuid) : undefined;
    if (actor) await ctx.snapshot(actor.uuid);
    if (scene) await ctx.snapshot(scene.uuid);

    const sha256 = sha256Bytes(bytes);
    const fp = resolveFilePicker();
    const dir = await ensureDirectories(fp, user.id);
    if ((await usedBytes(fp, dir)) + bytes.length > IMAGE_UPLOAD_USER_QUOTA_BYTES)
      invalid(
        `The per-user upload quota of ${IMAGE_UPLOAD_USER_QUOTA_BYTES} bytes would be exceeded`,
      );

    const name = serverName(bytes.length, args.mime);
    const path = `${dir}/${name}`;
    if (!normalizeDataPath(path).ok) invalid('Generated path is invalid');
    const file = new globalThis.File([bytes], name, { type: args.mime });
    let stored: any;
    try {
      stored = await fp.upload('data', dir, file, {}, { notify: false });
    } catch (error) {
      if (error instanceof WriteError) throw error;
      invalid(`Upload failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (stored?.status !== 'success' || typeof stored.path !== 'string')
      invalid('Foundry refused or failed the upload');
    let storedPath = '';
    try {
      storedPath = decodeURIComponent(stored.path);
    } catch {
      /* leaves the mismatch below to refuse */
    }
    if (storedPath !== path) invalid('Foundry stored the file at an unexpected path');

    const updated: string[] = [];
    const applied: string[] = [];
    if (actor) {
      const changes: Record<string, string> = {};
      if (args.setPortrait) changes.img = path;
      if (args.setToken) changes['prototypeToken.texture.src'] = path;
      await actor.update(changes, ctx.callOptions);
      updated.push(actor.uuid);
      applied.push(
        [args.setPortrait && 'portrait', args.setToken && 'token art']
          .filter(Boolean)
          .join(' and '),
      );
    }
    if (scene) {
      if (foundryGeneration() >= 14)
        await scene.updateEmbeddedDocuments(
          'Level',
          [{ _id: firstLevelId(scene), 'background.src': path }],
          ctx.callOptions,
        );
      else await scene.update({ 'background.src': path }, ctx.callOptions);
      updated.push(scene.uuid);
      applied.push('scene background');
    }

    // The first line is what the audit keeps: destination, size, type and hash, never the payload.
    const head = `Uploaded ${path} (${bytes.length} bytes, ${args.mime}, sha256 ${sha256})`;
    const tail = applied.length
      ? `Set ${applied.join('; ')}. Undo restores the previous image fields but does not delete the uploaded file.`
      : 'The file is stored; Undo does not delete the uploaded file.';
    return {
      text: `${head}\n${tail}`,
      structured: { path, mime: args.mime, bytes: bytes.length, sha256, updated },
    };
  },
});
