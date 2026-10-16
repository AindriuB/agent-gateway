/* eslint-disable @typescript-eslint/no-explicit-any */
import { isImagePath, normalizeDataPath, sniffImage } from '@agent-gateway/protocol';
import { fromUuidCompat } from '../compat/index.js';
import type { OpHandler } from '../ops/types.js';
import { folderAllowed } from '../policy/folders.js';
import { inlineText } from '../serialise/index.js';
import { WriteError, forbid, invalid, trustedUser } from './_write.js';

declare const globalThis: any;

/** Raw cap of the returned image (task 52 findings), and the cap on the source read. */
export const MAX_IMAGE_BYTES = 512 * 1024;
export const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
export const MAX_LONG_EDGE = 1568;
const JPEG_QUALITY = 0.85;

/** The root world document must be inside the agent class's folder allowlist, GMs included. */
const canSee = (doc: any, user: any): boolean =>
  doc != null &&
  folderAllowed(doc, user.isGM === true) &&
  (user.isGM === true || doc?.testUserPermission?.(user, 'LIMITED') === true);

const REFUSED = 'You cannot view this image';

async function load(uuid: unknown, type: string): Promise<any> {
  if (typeof uuid !== 'string' || uuid === '') return invalid(`uuid is required for this source`);
  let doc: any = null;
  try {
    doc = await fromUuidCompat(uuid);
  } catch {
    doc = null;
  }
  // A missing or wrong-type document looks exactly like one the user cannot view, so uuids cannot
  // be probed (as in document_get). Nothing is echoed.
  if (!doc || doc.documentName !== type) return forbid(REFUSED);
  return doc;
}

/** The Data path of the image, after the visibility test and before any request. */
async function resolveSource(
  args: { source: string; uuid?: string; path?: string },
  user: any,
): Promise<string> {
  const refuse = () => forbid(REFUSED);
  switch (args.source) {
    case 'actor_portrait':
    case 'actor_token': {
      const actor = await load(args.uuid, 'Actor');
      if (!canSee(actor, user)) return refuse();
      return String(
        (args.source === 'actor_portrait' ? actor.img : actor.prototypeToken?.texture?.src) ?? '',
      );
    }
    case 'token': {
      const token = await load(args.uuid, 'Token');
      const scene = token.parent;
      if (!canSee(scene, user)) return refuse();
      if (user.isGM !== true && token.hidden === true && token.isOwner !== true) return refuse();
      return String(token.texture?.src ?? '');
    }
    case 'scene_background': {
      const scene = await load(args.uuid, 'Scene');
      if (!canSee(scene, user)) return refuse();
      return String(scene.background?.src ?? '');
    }
    default:
      if (user.isGM !== true && user.can?.('FILES_BROWSE') !== true)
        return forbid('Viewing files requires the FILES_BROWSE permission');
      if (typeof args.path !== 'string' || args.path === '')
        return invalid('path is required for source file');
      return args.path;
  }
}

async function readCapped(url: string): Promise<Uint8Array> {
  let response: any;
  try {
    response = await globalThis.fetch(url, { credentials: 'same-origin' });
  } catch {
    return invalid('The image could not be fetched');
  }
  if (!response?.ok) return invalid(`The image could not be fetched (HTTP ${response?.status})`);
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES)
    return invalid(`The image is ${declared} bytes; the limit is ${MAX_SOURCE_BYTES} bytes`);
  const reader = response.body?.getReader?.();
  if (!reader) return invalid('The image could not be read');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total > MAX_SOURCE_BYTES) {
      await reader.cancel();
      return invalid(`The image is over ${MAX_SOURCE_BYTES} bytes, the limit`);
    }
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return bytes;
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return globalThis.btoa(s);
}

const routed = (path: string): string => {
  const getRoute = globalThis.foundry?.utils?.getRoute;
  return typeof getRoute === 'function' ? getRoute(path) : `/${path}`;
};

export const imageViewHandler: OpHandler = async (ctx) => {
  try {
    const user = trustedUser(ctx);
    const args = ctx.args as { source: string; uuid?: string; path?: string };
    const raw = await resolveSource(args, user);
    const normalized = normalizeDataPath(raw);
    if (!normalized.ok || !isImagePath(raw))
      return invalid('The image must be a PNG, JPEG or WebP file in the Data folder');
    const source = await readCapped(routed(normalized.path));
    const mime = sniffImage(source);
    if (!mime) return invalid('The file is not a PNG, JPEG or WebP image');
    let bitmap: any;
    try {
      bitmap = await globalThis.createImageBitmap(new globalThis.Blob([source], { type: mime }));
    } catch {
      return invalid('The image cannot be decoded');
    }
    let out = source;
    let outMime: string = mime;
    let { width, height } = bitmap as { width: number; height: number };
    const original = `${width}x${height}, ${source.length} bytes`;
    let downscaled = false;
    try {
      if (Math.max(width, height) > MAX_LONG_EDGE || source.length > MAX_IMAGE_BYTES) {
        const scale = Math.min(1, MAX_LONG_EDGE / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = new globalThis.OffscreenCanvas(width, height);
        const g = canvas.getContext('2d');
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, width, height);
        g.drawImage(bitmap, 0, 0, width, height);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
        out = new Uint8Array(await blob.arrayBuffer());
        outMime = 'image/jpeg';
        downscaled = true;
        if (out.length > MAX_IMAGE_BYTES)
          return invalid(
            `The image is still ${out.length} bytes after downscaling; the limit is ${MAX_IMAGE_BYTES} bytes`,
          );
      }
    } finally {
      bitmap.close?.();
    }
    const label = args.source === 'file' ? `file ${inlineText(String(args.path))}` : args.source;
    const text =
      `Image from ${label}: ${outMime}, ${width}x${height} px, ${out.length} bytes. ` +
      (downscaled
        ? `Downscaled to at most ${MAX_LONG_EDGE} px and re-encoded as JPEG (original ${original}).`
        : 'Not downscaled.');
    return { text, images: [{ mimeType: outMime as 'image/png', data: base64(out) }] };
  } catch (error) {
    if (error instanceof WriteError) return { error: { code: error.code, message: error.message } };
    throw error;
  }
};
