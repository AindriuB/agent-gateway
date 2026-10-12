/* eslint-disable @typescript-eslint/no-explicit-any */
import { APPROVAL_WAIT_MS } from '@agent-gateway/protocol';
export const TASK30_PENDING_MS = APPROVAL_WAIT_MS + 20000;
/** Pure scope/pin validation. Importing this file never connects to Foundry. */
export const TASK30_PINS = Object.freeze({
  source: '57adb9ac24903db62a5ffc1d38887133dcda4d7c',
  bundle: '84ea050e388ad8b105987ffd9cb988c5bc486c73181dbc005fe0bd7e1964cd0d',
});
export function task30Plan(run: string, gmId: string) {
  if (!/^[a-f0-9]{12}$/.test(run) || !gmId || gmId.length > 100)
    throw Error('Bounded nonce and canonical GM required');
  const prefix = `Task30-${run}`;
  return {
    prefix,
    fixtureCount: 1,
    toolRequests: 2,
    retainedAudits: 1,
    actor: {
      name: `${prefix}-NPC`,
      type: 'npc',
      ownership: { default: 0, [gmId]: 3 },
      items: [],
      effects: [],
      flags: { world: { task30: run } },
    },
    names: [`${prefix}-approved`, `${prefix}-denied`],
    denialReason: `${prefix} deliberate denial`,
  };
}
export function task30Receipt(input: unknown): string {
  const r = input as { status?: unknown; id?: unknown } | undefined;
  if (
    !r ||
    r.status !== 'pending_approval' ||
    typeof r.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{32}$/.test(r.id)
  )
    throw Error('Exact durable queue receipt required');
  return r.id;
}
export function task30Status(input: unknown, id: string, status: string) {
  const r = input as { id?: unknown; status?: unknown } | undefined;
  if (!r || r.id !== id || r.status !== status) throw Error('Owner receipt status mismatch');
  return r;
}

/** Failure in one teardown phase never skips closing the other owned resources. */
export async function task30SafePhase(
  errors: string[],
  label: string,
  op: () => unknown | Promise<unknown>,
) {
  try {
    await op();
  } catch (error) {
    errors.push(`${label}: ${String(error)}`);
  }
}
export function task30Attestation(
  records: unknown[],
  ids: string[],
  gmName: string,
  reason: string,
) {
  const approved = records.find((r: any) => r.id === ids[0]) as any;
  const denied = records.find((r: any) => r.id === ids[1]) as any;
  if (
    approved?.scope !== 'once' ||
    approved.resolvedBy !== gmName ||
    denied?.reason !== reason ||
    denied.resolvedBy !== gmName
  )
    throw Error('Native once/denial attestation mismatch');
  return { approved, denied };
}

/** Native pending reports follow the real approval wait; probes remain bounded. */
export async function task30AwaitPending(
  check: () => boolean,
  clock: { now(): number; sleep(ms: number): Promise<void> },
) {
  const deadline = clock.now() + TASK30_PENDING_MS;
  while (!check()) {
    if (clock.now() >= deadline) throw Error('Native pending replay deadline');
    await clock.sleep(100);
  }
}

/** Preserve the primary acceptance error; cleanup errors remain separately recorded evidence. */
export function task30TeardownFailure(primary: unknown, errors: string[]) {
  if (errors.length && !primary)
    throw Error('Native teardown requires reconciliation: ' + errors.join('; '));
}
