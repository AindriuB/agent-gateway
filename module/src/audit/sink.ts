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
