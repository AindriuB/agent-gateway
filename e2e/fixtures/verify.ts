import { E2E_RATE_LIMITS, expectedFlaggedCounts, type SeedType } from './spec.js';

export type Counts = Record<string, { flagged: number; unflagged: number }>;

export interface FixtureResult {
  before: Counts;
  after: Counts;
  totals: Record<string, number>;
  /** UUIDs of the documents a player cannot find by searching. */
  uuids: Record<string, string>;
  /** The playerAgentsEnabled setting around the run: `before` is read by seed; `after` is set when the run changed it. */
  policy?: { before?: boolean; after?: boolean };
  /** The rateLimits setting around the run, as stored (a JSON string): same semantics as `policy`. */
  rateLimits?: { before?: string; after?: string };
}

/** Problems found in a seed or clean result; empty means the run did what it promised. */
export function verifyFixtureResult(
  mode: 'seed' | 'clean',
  r: FixtureResult,
  restore?: boolean,
  restoreRateLimits?: string,
): string[] {
  const problems: string[] = [];
  const want = expectedFlaggedCounts();
  for (const [type, after] of Object.entries(r.after)) {
    const before = r.before[type];
    if (before && before.unflagged !== after.unflagged) {
      problems.push(
        `${type}: unflagged documents changed ${before.unflagged} -> ${after.unflagged}`,
      );
    }
    const flagged = mode === 'seed' ? (want[type as SeedType] ?? 0) : 0;
    if (after.flagged !== flagged) {
      problems.push(
        `${type}: ${after.flagged} flagged documents after ${mode}, expected ${flagged}`,
      );
    }
  }
  if (mode === 'seed' && r.policy?.after !== true) {
    problems.push('the seed did not leave playerAgentsEnabled on');
  }
  if (mode === 'clean' && restore !== undefined && r.policy?.after !== restore) {
    problems.push(`clean did not restore playerAgentsEnabled to ${restore}`);
  }
  if (mode === 'seed' && r.rateLimits?.after !== E2E_RATE_LIMITS) {
    problems.push('the seed did not leave the e2e rate limits in place');
  }
  if (
    mode === 'clean' &&
    restoreRateLimits !== undefined &&
    r.rateLimits?.after !== restoreRateLimits
  ) {
    problems.push('clean did not restore the rateLimits setting');
  }
  if (mode === 'seed' && typeof r.totals.blindRollTotal !== 'number') {
    problems.push('the blind roll total was not recorded');
  }
  return problems;
}

export function formatCounts(label: string, counts: Counts): string {
  const rows = Object.entries(counts).map(
    ([t, c]) =>
      `  ${t.padEnd(13)} flagged ${String(c.flagged).padStart(3)}  unflagged ${String(c.unflagged).padStart(4)}`,
  );
  return [`${label}:`, ...rows].join('\n');
}
