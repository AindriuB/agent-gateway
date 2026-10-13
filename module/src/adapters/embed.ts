/* eslint-disable @typescript-eslint/no-explicit-any */
import { genericEmbedHook } from './generic/embed.js';
import { pf2eEmbedHook } from './pf2e/embed.js';

/** The bounded, system-neutral overrides compendium_import accepts for an embedded Item. */
export interface EmbedOverrides {
  readonly quantity?: number;
  readonly equipped?: boolean;
  readonly slot?: string;
}
export interface EmbedInput {
  readonly systemId: string;
  readonly actor: any;
  /** The compendium entry, for read-only inspection. */
  readonly entry: any;
  /** A fresh, owned copy of the converted source; a hook may return it modified. */
  readonly source: Record<string, any>;
  readonly overrides: EmbedOverrides;
}
export interface EmbedObservation {
  /** Native writes made without audit callOptions while the embed ran. */
  finish(): number;
}
/**
 * System-specific translation for embedding a compendium Item in an Actor. A hook refuses with
 * INVALID_ARGS (WriteError) and never prompts: the native create runs headless.
 */
export interface EmbedHook {
  readonly systemId: string;
  prepare(input: EmbedInput): Promise<Record<string, any>> | Record<string, any>;
  /** Start counting native writes that carry no audit callOptions. */
  observe?(actor: any): EmbedObservation;
}

const HOOKS: Readonly<Record<string, EmbedHook>> = Object.freeze({ pf2e: pf2eEmbedHook });
export const embedHookFor = (systemId: string): EmbedHook =>
  Object.hasOwn(HOOKS, systemId) ? HOOKS[systemId]! : genericEmbedHook;
