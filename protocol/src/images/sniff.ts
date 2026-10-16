export const IMAGE_MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp'] as const);
export const IMAGE_EXTENSIONS = Object.freeze(['.png', '.jpg', '.jpeg', '.webp'] as const);
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

const starts = (b: Uint8Array, sig: readonly number[], at = 0): boolean =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

/** Identify an image by magic bytes. Returns null for anything else (including SVG and GIF). */
export function sniffImage(bytes: Uint8Array): ImageMimeType | null {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp';
  return null;
}
