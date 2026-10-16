import { z } from 'zod';
import { defineTool } from './define.js';

/** Raw cap per upload, from the task 52 findings (fits both live and queued frames). */
export const IMAGE_UPLOAD_MAX_BYTES = 512 * 1024;
/** Base64 length of IMAGE_UPLOAD_MAX_BYTES: 4 * ceil(524288 / 3). */
export const IMAGE_UPLOAD_MAX_BASE64 = 699052;
/** Total stored bytes per user under agent-gateway/uploads/<userId>/. */
export const IMAGE_UPLOAD_USER_QUOTA_BYTES = 64 * 1024 * 1024;

export const imageUpload = defineTool({
  name: 'image_upload',
  minRole: 'player',
  category: 'write',
  handledBy: 'module',
  redactArgs: ['data'],
  description:
    'Upload one PNG, JPEG or WebP image of up to 512 KiB to a server-named file. Optionally set an owned Actor portrait or token art; a GM may set a Scene background. The file is kept if the change is undone.',
  input: z.strictObject({
    data: z
      .string()
      .min(1)
      .max(IMAGE_UPLOAD_MAX_BASE64)
      .describe('Base64 image bytes, at most 512 KiB decoded'),
    mime: z.enum(['image/png', 'image/jpeg', 'image/webp']).describe('Image type; must match data'),
    actorUuid: z.string().min(1).max(256).optional().describe('Actor to update with the image'),
    setPortrait: z.boolean().optional().describe('Set the Actor portrait image'),
    setToken: z.boolean().optional().describe('Set the Actor prototype token art'),
    sceneUuid: z.string().min(1).max(256).optional().describe('Scene to update (GM only)'),
    setBackground: z.boolean().optional().describe('Set the Scene background image'),
  }),
  output: z.strictObject({
    path: z.string().max(300).describe('Data-relative path of the stored file'),
    mime: z.string().max(40).describe('Stored image type'),
    bytes: z.number().int().min(1).max(IMAGE_UPLOAD_MAX_BYTES).describe('Decoded size in bytes'),
    sha256: z.string().length(64).describe('SHA-256 of the decoded bytes, hex'),
    updated: z.array(z.string().max(300)).max(4).describe('Documents updated with the path'),
  }),
});

export interface ImageUploadSummary {
  path: string;
  bytes: number;
  mime: string;
  sha256: string;
  updated: string[];
}

/**
 * Recover the upload details from the result text. The handler's first line is
 * `Uploaded <path> (<n> bytes, <mime>, sha256 <hex>)` and an optional second line is
 * `Updated: <uuid>, <uuid>`. Used when only the text survives, e.g. after a long approval wait.
 */
export function parseImageUploadText(text: string): ImageUploadSummary | null {
  const lines = text.split('\n');
  const m = /^Uploaded (\S+) \((\d+) bytes, (image\/[a-z]+), sha256 ([0-9a-f]{64})\)$/.exec(
    lines[0] ?? '',
  );
  if (!m) return null;
  const u = /^Updated: (.+)$/.exec(lines[1] ?? '');
  return {
    path: m[1]!,
    bytes: Number(m[2]),
    mime: m[3]!,
    sha256: m[4]!,
    updated: u ? u[1]!.split(', ') : [],
  };
}
