import { z } from 'zod';
import { defineTool } from './define.js';

export const IMAGE_VIEW_SOURCES = [
  'actor_portrait',
  'actor_token',
  'token',
  'scene_background',
  'file',
] as const;

export const imageView = defineTool({
  name: 'image_view',
  minRole: 'player',
  category: 'read',
  handledBy: 'module',
  description:
    'View an image as an image content block: an Actor portrait or prototype token art (uuid), a placed token texture (uuid), a Scene background (uuid) or a Data file (path). PNG, JPEG and WebP only; large images are downscaled to JPEG. Returns a text description with the dimensions, mime type and size.',
  input: z.strictObject({
    source: z.enum(IMAGE_VIEW_SOURCES).describe('Where the image comes from'),
    uuid: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe('Actor, Token or Scene UUID; required for every source except file'),
    path: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe('Data-relative image path; required for source file'),
  }),
  // Empty on purpose: the image travels in the result's image block, with no structured content.
  output: z.strictObject({}),
  mcpOutputSchema: false,
});
