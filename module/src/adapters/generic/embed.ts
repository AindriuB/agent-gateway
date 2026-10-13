/* eslint-disable @typescript-eslint/no-explicit-any */
import type { EmbedHook, EmbedInput } from '../embed.js';
import { invalid } from '../../tools/_write.js';

export const genericEmbedHook: EmbedHook = Object.freeze({
  systemId: 'generic',
  prepare({ systemId, source, overrides }: EmbedInput): Record<string, any> {
    if (Object.values(overrides).some((v) => v !== undefined))
      invalid(`Override not supported for ${systemId}`);
    return source;
  },
});
