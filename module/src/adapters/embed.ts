/* eslint-disable @typescript-eslint/no-explicit-any */
import { genericEmbedHook } from './generic/embed.js';
import { pf2eEmbedHook } from './pf2e/embed.js';

/** The bounded, system-neutral overrides compendium_import accepts for an embedded Item. */
export interface EmbedOverrides {
  readonly quantity?: number;
  readonly equipped?: boolean;
  readonly slot?: string;
}
/** One answer to a ChoiceSet prompt; validated by the protocol before it gets here. */
export interface ChoiceDecision {
  readonly flag: string;
  readonly itemUuid?: string;
  readonly value: string;
}
export interface ChoiceReportEntry {
  readonly flag: string;
  readonly itemUuid?: string;
  readonly status: 'answered' | 'unanswered' | 'rejected' | 'unsupported';
}
export interface EmbedInput {
  readonly systemId: string;
  readonly actor: any;
  /** The compendium entry, for read-only inspection. */
  readonly entry: any;
  /** A fresh, owned copy of the converted source; a hook may return it modified. */
  readonly source: Record<string, any>;
  readonly overrides: EmbedOverrides;
  /** The executing user; used to keep resolved options to documents it may observe. */
  readonly user?: unknown;
  /** Optional answers to the item's (and its grants') ChoiceSet prompts. */
  readonly choices?: readonly ChoiceDecision[];
  /** `reject` (default) refuses unanswered choices before any write; `ignore` reports them. */
  readonly onUnanswered?: 'reject' | 'ignore';
}
export interface EmbedRunInput {
  readonly actor: any;
  /** The audit call id carried in the native create options (`agentGateway.callId`). */
  readonly callId: string;
  readonly choices?: readonly ChoiceDecision[];
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
  /**
   * Run the native create with the choice answers in force. The returned report lists every
   * ChoiceSet the system raised during the call. Absent: the create runs as-is, no report.
   */
  run?<T>(
    input: EmbedRunInput,
    create: () => Promise<T>,
  ): Promise<{ value: T; report: ChoiceReportEntry[]; timedOut?: boolean }>;
  /** Start counting native writes that carry no audit callOptions. */
  observe?(actor: any): EmbedObservation;
}

const HOOKS: Readonly<Record<string, EmbedHook>> = Object.freeze({ pf2e: pf2eEmbedHook });
export const embedHookFor = (systemId: string): EmbedHook =>
  Object.hasOwn(HOOKS, systemId) ? HOOKS[systemId]! : genericEmbedHook;
