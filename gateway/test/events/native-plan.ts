/** Pure Task28 native acceptance scope. Importing it performs no browser/world operations. */
import { DatabaseSync } from 'node:sqlite';
import { EventReadOutput } from '@agent-gateway/protocol';
export function task28Pins(
  source = '5059015ce17480f65dbe3629bb8db3a1a60c9782',
  bundle = '8cf825b62772e7efd76a1b1d6162d8443b5047b90fa1c3fb8df05f06214b8dbf',
) {
  if (!/^[a-f0-9]{40}$/.test(source) || !/^[a-f0-9]{64}$/.test(bundle))
    throw Error('Exact reviewed source/build pins required');
  return { source, bundle };
}
export function task28Plan(run: string, gmId: string) {
  if (!/^[a-f0-9]{12}$/.test(run) || !gmId || gmId.length > 100)
    throw Error('Bounded fixture nonce and canonical GM ID required');
  const prefix = `Task28-${run}`;
  return {
    prefix,
    fixtureCount: 1,
    actor: {
      name: `${prefix}-NPC`,
      type: 'npc',
      ownership: { default: 0, [gmId]: 3 },
      items: [],
      effects: [],
      flags: { world: { task28: run } },
    },
    names: [`${prefix}-first`, `${prefix}-second`],
  };
}
export function assertTask28Read(input: unknown, userId: string, forbidden: string[] = []) {
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

/** Reads existing credentials without migrations, PRAGMA writes or schema changes. */
export function task28ReadPairings(path: string, worldId: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT id, token_hash, world_id, user_id, user_name
      FROM pairings WHERE revoked_at IS NULL AND world_id = ? LIMIT 257`,
      )
      .all(worldId);
    if (rows.length > 256) throw Error('Native pairing import exceeds bound');
    return rows.map((row) => {
      for (const key of ['id', 'token_hash', 'world_id', 'user_id', 'user_name'])
        if (typeof row[key] !== 'string' || (row[key] as string).length > 1024)
          throw Error('Native pairing field unavailable or unbounded');
      if (!row.id || !row.token_hash || !row.user_id || row.world_id !== worldId)
        throw Error('Native exact pairing unavailable');
      return {
        id: row.id as string,
        tokenHash: row.token_hash as string,
        worldId: row.world_id as string,
        userId: row.user_id as string,
        userName: row.user_name as string,
      };
    });
  } finally {
    db.close();
  }
}

/** Observe rejection immediately while preserving it for the eventual consumer. */
export function task28Track<T>(pending: Set<Promise<unknown>>, promise: Promise<T>): Promise<T> {
  const observed = promise.then(
    () => undefined,
    () => undefined,
  );
  pending.add(observed);
  void observed.then(() => pending.delete(observed));
  return promise;
}

/** Closing one session must not prevent the remaining polls from draining. */
export async function task28Drain(
  clients: { close(): Promise<void> }[],
  pending: Set<Promise<unknown>>,
  timeoutMs = 5000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        await Promise.allSettled(
          clients.map((client) => Promise.resolve().then(() => client.close())),
        );
        await Promise.allSettled([...pending]);
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('Native polls did not settle')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
