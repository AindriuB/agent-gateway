import { z } from 'zod';
import { defineTool } from './define.js';
export const playlistControl = defineTool({
  name: 'playlist_control',
  minRole: 'gm',
  category: 'write',
  handledBy: 'module',
  description:
    'Control bounded native world playlist playback or sound volume; later audio lifecycle events remain native.',
  input: z.strictObject({
    playlistUuid: z.string().min(1).max(256).describe('Canonical world Playlist UUID'),
    action: z.enum(['play', 'stop', 'next', 'set_volume']).describe('Playback operation'),
    soundUuid: z.string().min(1).max(256).describe('Canonical sound in this playlist').optional(),
    volume: z
      .number()
      .finite()
      .min(0)
      .max(1)
      .describe('Sound volume for set_volume only')
      .optional(),
  }),
  output: z.strictObject({
    uuid: z.string().min(1).max(256).describe('Updated playlist UUID'),
    action: z.string().max(32).describe('Completed operation'),
    completed: z.boolean().describe('Native document update persisted'),
  }),
});
