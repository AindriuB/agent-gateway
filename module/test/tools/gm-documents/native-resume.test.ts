import { expect, it } from 'vitest';
import { attachNativeBaseline } from './native-resume.js';
import { TASK23_SOURCE } from './native-plan.js';
function fixture() {
  const roots = [
    'Actor.aaaaaaaaaaaaaaaa',
    'JournalEntry.jjjjjjjjjjjjjjjj',
    'Item.iiiiiiiiiiiiiiii',
  ];
  const snapshots = roots.map((uuid) => ({
    _id: uuid.split('.').at(-1),
    name: 'original',
    flags: { world: { nested: 'preserved' } },
  }));
  const source = {
    uuid: TASK23_SOURCE,
    source: { _id: 'rQWaJhI5Bko5x14Z', name: 'Dagger', system: { nested: 'original' } },
  };
  const fresh = {
    version: 'v14',
    fixtureRun: '0123456789ab',
    userId: 'gm',
    agentId: 'agent',
    roots,
    snapshots,
    created: [
      ...roots,
      `${roots[0]}.ActiveEffect.eeeeeeeeeeeeeeee`,
      `${roots[1]}.JournalEntryPage.pppppppppppppppp`,
    ],
    audits: Array.from({ length: 8 }, (_, i) => ({
      uuid: `JournalEntry.audit.JournalEntryPage.audit${i}`,
      system: { status: 'ok', userId: 'gm', agentId: 'agent', relayed: false },
    })),
    deleteAudit: { uuid: 'JournalEntry.audit.JournalEntryPage.audit7', id: 'audit7' },
    sourceAtResume: source.source,
    originalSourceUnavailable: true,
  };
  const calls = {
    fixtureRun: fresh.fixtureRun,
    version: 'v14',
    sha: 'verified',
    originalSourceUnavailable: false,
    source,
    baselineRoots: ['Actor.preexisting'],
    auditBaseline: ['old-audit'],
    originalCombats: [],
    originalView: { scene: null, combat: null, targets: [] },
    originalWorldTime: 123,
  };
  const undo = {
    ...calls,
    created: fresh.created,
    roots,
    beforeDelete: snapshots,
    retainedAuditUuids: fresh.audits.map((r) => r.uuid),
  };
  return { fresh, calls, undo };
}
it('preserves latest durable full source and original baselines alongside freshly attested audit identity without MCP calls', () => {
  const { fresh, calls, undo } = fixture();
  const result = attachNativeBaseline(fresh, calls, undo, 'verified');
  expect(result.originalSourceUnavailable).toBe(false);
  expect(result.originalSource).toEqual(calls.source);
  expect(result.originalBaselines).toMatchObject({
    originalWorldTime: 123,
    baselineRoots: ['Actor.preexisting'],
  });
  expect(result.deleteAudit).toEqual(fresh.deleteAudit);
  expect(fresh.originalSourceUnavailable).toBe(true);
});
it.each(['nonce', 'sha', 'source', 'snapshot', 'audit', 'historical', 'baseline'])(
  'rejects %s custody mismatch before any resume',
  (kind) => {
    const { fresh, calls, undo } = fixture();
    if (kind === 'nonce') undo.fixtureRun = '000000000000';
    if (kind === 'sha') calls.sha = 'wrong';
    if (kind === 'source') fresh.sourceAtResume = { ...fresh.sourceAtResume, name: 'changed' };
    if (kind === 'snapshot')
      undo.beforeDelete = [
        { ...undo.beforeDelete[0]!, name: 'forged' },
        ...undo.beforeDelete.slice(1),
      ];
    if (kind === 'audit')
      undo.retainedAuditUuids = ['unrelated', ...undo.retainedAuditUuids.slice(1)];
    if (kind === 'historical') calls.originalSourceUnavailable = true;
    if (kind === 'baseline') calls.originalWorldTime = Number.NaN;
    expect(() => attachNativeBaseline(fresh, calls, undo, 'verified')).toThrow();
  },
);

it('accepts only completion-order differences while preserving ordered root-to-snapshot custody', () => {
  const { fresh, calls, undo } = fixture();
  undo.created = [
    fresh.created[0]!,
    fresh.created[1]!,
    fresh.created[2]!,
    fresh.created[4]!,
    fresh.created[3]!,
  ];
  expect(attachNativeBaseline(fresh, calls, undo, 'verified').created).toEqual(fresh.created);
  expect(() =>
    attachNativeBaseline(
      fresh,
      calls,
      { ...undo, created: [...undo.created.slice(0, 4), 'Actor.victim'] },
      'verified',
    ),
  ).toThrow();
  expect(() =>
    attachNativeBaseline(
      fresh,
      calls,
      { ...undo, created: [...undo.created.slice(0, 4), undo.created[0]] },
      'verified',
    ),
  ).toThrow();
  expect(() =>
    attachNativeBaseline(fresh, calls, { ...undo, roots: [...undo.roots].reverse() }, 'verified'),
  ).toThrow();
  expect(() =>
    attachNativeBaseline(
      fresh,
      calls,
      { ...undo, beforeDelete: [...undo.beforeDelete].reverse() },
      'verified',
    ),
  ).toThrow();
});
