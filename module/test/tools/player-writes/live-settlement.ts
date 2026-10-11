/** Attach rejection tracking before UI preparation can fail, and keep cleanup behind every call. */
export function startLiveBatch<T>(calls: readonly Promise<T>[]) {
  const settled = Promise.allSettled(calls);
  return {
    settled,
    async result(afterSuccess?: () => Promise<unknown>): Promise<T[]> {
      const results = await settled;
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length)
        throw new AggregateError(
          failures.map((result) => result.reason),
          'Native call batch failed after every call settled',
        );
      await afterSuccess?.();
      return results.map((result) => (result as PromiseFulfilledResult<T>).value);
    },
  };
}

export async function settleLiveBatch<T>(calls: readonly Promise<T>[]): Promise<T[]> {
  return startLiveBatch(calls).result();
}

/** Relayed persistence trails tool results; keep the GM alive for a bounded, observable drain. */
export async function waitForLiveAudit<T extends { key: string }>(
  read: () => Promise<T[]>,
  expected: readonly string[],
  deps: { now?: () => number; sleep?: () => Promise<void>; timeoutMs?: number } = {},
): Promise<T[]> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
  const deadline = now() + (deps.timeoutMs ?? 10_000);
  for (let attempt = 0; attempt <= 100; attempt++) {
    const rows = await read();
    const missing = expected.filter((key) => rows.filter((row) => row.key === key).length !== 1);
    if (!missing.length) return rows;
    if (now() >= deadline || attempt === 100)
      throw Error(`Native audit persistence incomplete after bounded wait: ${missing.join(', ')}`);
    await sleep();
  }
  throw Error('Native audit persistence wait exhausted');
}

export interface LiveAuditRow {
  uuid: string;
  entryId: string;
  userId: string;
  agentId: string;
  tool: string;
  args: string;
}

/** This exact projection runs in Foundry and is exercised with native-shaped audit pages. */
export function readNativeAuditRows(baseline: string[]): LiveAuditRow[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const game = (globalThis as any).game;
  const journal = game.journal.get(game.settings.get('agent-gateway', 'auditJournalId'));
  return (journal?.pages.contents ?? [])
    .filter(
      (page: { uuid: string; system: Omit<LiveAuditRow, 'uuid'> }) => !baseline.includes(page.uuid),
    )
    .map((page: { uuid: string; system: Omit<LiveAuditRow, 'uuid'> }) => ({
      uuid: page.uuid,
      entryId: page.system.entryId,
      userId: page.system.userId,
      agentId: page.system.agentId,
      tool: page.system.tool,
      args: page.system.args,
    }));
}

export const liveAuditKey = (
  userId: string,
  agentId: string,
  tool: string,
  args: Record<string, unknown>,
) =>
  JSON.stringify([
    userId,
    agentId,
    tool,
    Object.entries(args).sort(([a], [b]) => a.localeCompare(b)),
  ]);
