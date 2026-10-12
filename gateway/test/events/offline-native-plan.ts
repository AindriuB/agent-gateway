/** Pure Task29 native acceptance scope. Importing it performs no browser/world operations. */
import { EventReadOutput } from '@agent-gateway/protocol';
export function task29Pins(
  source = '88b27ca2b273d1f9778cc78a6e22967c2be2c9a8',
  bundle = 'd19791ab8a7e38e365c4e84a76f4615fe80b99ec64f576b34bc331bff3b99101',
) {
  if (!/^[a-f0-9]{40}$/.test(source) || !/^[a-f0-9]{64}$/.test(bundle))
    throw Error('Exact reviewed source/build pins required');
  return { source, bundle };
}
export function task29Plan(run: string, gmId: string) {
  if (!/^[a-f0-9]{12}$/.test(run) || !gmId || gmId.length > 100)
    throw Error('Bounded fixture nonce and canonical GM ID required');
  const prefix = `Task29-${run}`;
  return {
    prefix,
    fixtureCount: 1,
    actor: {
      name: `${prefix}-NPC`,
      type: 'npc',
      ownership: { default: 0, [gmId]: 3 },
      items: [],
      effects: [],
      flags: { world: { task29: run } },
    },
    names: [`${prefix}-first`, `${prefix}-second`],
  };
}
export function assertTask29Read(input: unknown, userId: string, forbidden: string[] = []) {
  const result = EventReadOutput.parse(input);
  for (const row of result.events)
    if (
      row.event.userId !== userId ||
      forbidden.some((value) => JSON.stringify(row).includes(value))
    )
      throw Error('Observer-isolated native buffer proof failed');
  for (let i = 1; i < result.events.length; i++)
    if (result.events[i]!.cursor <= result.events[i - 1]!.cursor)
      throw Error('Gateway cursors must strictly increase');
  if (result.events.length && result.nextAfter !== result.events.at(-1)!.cursor)
    throw Error('Native continuation cursor mismatch');
  return result;
}

export const task29SettingSequence = Object.freeze([
  Object.freeze({ enabled: true, retentionDays: 14 }),
  Object.freeze({ enabled: false, retentionDays: 14 }),
  Object.freeze({ enabled: true, retentionDays: 14 }),
]);
export function task29SettingCustody(current: unknown, expected: unknown) {
  const valid = (x: unknown) =>
    !!x &&
    typeof x === 'object' &&
    !Array.isArray(x) &&
    Object.keys(x).sort().join(',') === 'enabled,retentionDays' &&
    typeof (x as { enabled: unknown }).enabled === 'boolean' &&
    Number.isInteger((x as { retentionDays: number }).retentionDays) &&
    (x as { retentionDays: number }).retentionDays >= 1 &&
    (x as { retentionDays: number }).retentionDays <= 365;
  if (!valid(current) || !valid(expected) || JSON.stringify(current) !== JSON.stringify(expected))
    throw Error('Offline setting custody changed');
}

/** A purge gap is meaningful only relative to an explicit previously valid cursor. */
export const task29PostPurgeCursor = Object.freeze({ after: 0 });
