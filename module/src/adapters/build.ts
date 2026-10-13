import type { CharacterBuildChange, CharacterBuildOutput } from '@agent-gateway/protocol';
import type { AdapterExecutionContext, AdapterPayload } from './types.js';
import { genericBuildHook } from './generic/build.js';
import { pf2eBuildHook } from './pf2e/build.js';

export type BuildPayload = AdapterPayload<CharacterBuildOutput>;
/**
 * A system's character-build interface. Separate from SystemAdapter on purpose: build support is
 * opt-in per system, and a system without a hook answers "unsupported".
 */
export interface BuildHook {
  readonly systemId: string;
  describe(actor: unknown): BuildPayload | Promise<BuildPayload>;
  /** Validate the whole batch before any write; write only through `context`. */
  apply(
    actor: unknown,
    changes: readonly CharacterBuildChange[],
    context: AdapterExecutionContext,
  ): BuildPayload | Promise<BuildPayload>;
}
/** Bundled hooks only. Future system tasks insert entries here; no public registration. */
const hooks: ReadonlyMap<string, BuildHook> = new Map([[pf2eBuildHook.systemId, pf2eBuildHook]]);
export function selectBuildHook(systemId: string): BuildHook {
  return hooks.get(systemId) ?? genericBuildHook;
}
