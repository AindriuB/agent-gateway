import { z } from 'zod';
import { defineTool } from './define.js';

/** Raw cap per upload, from the task 52 findings (fits both live and queued frames). */
export const IMAGE_UPLOAD_MAX_BYTES = 512 * 1024;
/** Base64 length of IMAGE_UPLOAD_MAX_BYTES: 4 * ceil(524288 / 3). */
export const IMAGE_UPLOAD_MAX_BASE64 = 699052;
/** Total stored bytes per user under agent-gateway/uploads/<userId>/. */
export const IMAGE_UPLOAD_USER_QUOTA_BYTES = 8 * 1024 * 1024;

export const imageUpload = defineTool({
  name: 'image_upload',
  minRole: 'player',
  category: 'write',
  handledBy: 'module',
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
