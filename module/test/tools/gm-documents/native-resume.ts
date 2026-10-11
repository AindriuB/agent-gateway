import { isDeepStrictEqual } from 'node:util';
import { assertNativeResumeCheckpoint, TASK23_SOURCE } from './native-plan.js';
/** Local durable custody check only. Fresh native reconciliation supplies all audit authority. */
export function attachNativeBaseline(fresh: unknown, calls: unknown, undo: unknown, sha: string) {
  assertNativeResumeCheckpoint(fresh);
  const a = calls as Record<string, unknown>;
  const b = undo as Record<string, unknown>;
  const equal = isDeepStrictEqual;
  if (
    a.fixtureRun !== fresh.fixtureRun ||
    b.fixtureRun !== fresh.fixtureRun ||
    a.version !== fresh.version ||
    b.version !== fresh.version ||
    a.sha !== sha ||
    b.sha !== sha ||
    a.originalSourceUnavailable !== false ||
    b.originalSourceUnavailable !== false ||
    !equal(a.source, b.source) ||
    // Concurrent calls finish in arbitrary order; require exactly the same five identities.
    !equal([...(b.created as string[])].sort(), [...fresh.created].sort()) ||
    !equal(b.roots, fresh.roots) ||
    !equal(b.beforeDelete, fresh.snapshots) ||
    !equal([...(b.retainedAuditUuids as string[])].sort(), fresh.audits.map((r) => r.uuid).sort())
  )
    throw Error('Durable current-run checkpoint custody mismatch');
  const source = a.source as { uuid: string; source: Record<string, unknown> };
  if (
    source?.uuid !== TASK23_SOURCE ||
    !equal(source.source, (fresh as unknown as Record<string, unknown>).sourceAtResume)
  )
    throw Error('Original compendium source differs from fresh source');
  const joined = {
    ...fresh,
    originalSourceUnavailable: false,
    originalSource: source,
    originalBaselines: {
      baselineRoots: a.baselineRoots as string[],
      auditBaseline: a.auditBaseline as string[],
      originalCombats: a.originalCombats as NonNullable<
        typeof fresh.originalBaselines
      >['originalCombats'],
      originalView: a.originalView,
      originalWorldTime: a.originalWorldTime as number,
    },
  };
  assertNativeResumeCheckpoint(joined);
  return joined;
}
