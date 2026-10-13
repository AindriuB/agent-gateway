import type { BuildHook } from '../build.js';
import { AdapterUnsupportedError } from '../types.js';

export const genericBuildHook: BuildHook = Object.freeze({
  systemId: 'generic',
  describe: () => ({ supported: false, boosts: [], skills: [], featSlots: [] }),
  apply() {
    throw new AdapterUnsupportedError();
  },
});
