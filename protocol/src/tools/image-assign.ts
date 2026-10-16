import { z } from 'zod';
import { defineTool } from './define.js';

export const IMAGE_ASSIGN_TARGETS = [
  'actor_portrait',
  'actor_token',
  'token',
  'scene_background',
  'tile',
] as const;

const entry = z.strictObject({
  path: z.string().min(1).max(256).describe('Canonical Data path'),
  name: z.string().min(1).max(256).describe('Display name'),
});

export const imageAssignOutput = z.strictObject({
  dirs: z.array(entry).max(200).optional().describe('Sub-directories (list)'),
  files: z.array(entry).max(200).optional().describe('Image files (list)'),
  truncated: z.boolean().optional().describe('Whether the listing was cut at the limit (list)'),
  path: z.string().min(1).max(256).optional().describe('Assigned Data path (set)'),
  target: z.enum(IMAGE_ASSIGN_TARGETS).optional().describe('Assigned target (set)'),
  uuid: z.string().min(1).max(256).optional().describe('Updated document UUID (set)'),
});
export type ImageAssignOutput = z.infer<typeof imageAssignOutput>;

export const imageAssign = defineTool({
  name: 'image_assign',
  minRole: 'player',
  category: 'read',
  handledBy: 'module',
  description:
    'List images in the Foundry Data files (read-only), or set an existing image as an Actor portrait, prototype token art, a placed token texture, a scene background or a tile texture (write; approval required).',
  input: z.strictObject({
    action: z.enum(['list', 'set']).describe('list browses a directory; set assigns an image'),
    dir: z
      .string()
      .max(256)
      .optional()
      .describe('list: Data directory; omit or empty for the Data root'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('list: maximum entries (default 100)'),
    path: z.string().min(1).max(256).optional().describe('set: Data path of an existing image'),
    target: z.enum(IMAGE_ASSIGN_TARGETS).optional().describe('set: what to assign the image to'),
    uuid: z.string().min(1).max(256).optional().describe('set: UUID of the target document'),
  }),
  output: imageAssignOutput,
});
