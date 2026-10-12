import { genericAdapter } from './generic/index.js';
import { pf2eAdapter } from './pf2e/index.js';
import type { SystemAdapter } from './types.js';
/** Bundled adapters only. Future system tasks insert entries here; no public registration. */
const adapters: ReadonlyMap<string, SystemAdapter> = new Map([[pf2eAdapter.systemId, pf2eAdapter]]);
export function selectAdapter(systemId: string): SystemAdapter {
  return adapters.get(systemId) ?? genericAdapter;
}
