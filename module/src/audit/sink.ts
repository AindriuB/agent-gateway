import type { AuditRecord } from './types.js';

type Sink = (record: AuditRecord) => Promise<void>;
let sink: Sink | null = null;

/** Where finished records go: the journal on a GM client, the relay on a player client. */
export function setAuditSink(next: Sink | null): void {
  sink = next;
}

export async function submitAudit(record: AuditRecord): Promise<void> {
  if (!sink) throw new Error('audit sink is not installed');
  await sink(record);
}

type IntentFn = (callId: string, what: { uuid?: string; creates?: boolean }) => Promise<boolean>;
let intent: IntentFn | null = null;

export function setIntentRequester(fn: IntentFn | null): void {
  intent = fn;
}

/** Player client: ask the active GM to witness part of a call. False when it cannot. */
export async function requestAuditIntent(
  callId: string,
  what: { uuid?: string; creates?: boolean },
): Promise<boolean> {
  return intent ? intent(callId, what) : false;
}
