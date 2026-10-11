import { expect, it } from 'vitest';
import {
  assertNativeBundleHash,
  assertNativeResumeCheckpoint,
  assertNativeApprovalCards,
  assertNativeUpdateDiff,
  nativeDestructivePolicy,
  nativeDocumentPlan,
  returnedDocumentUuid,
  undoComparable,
} from './native-plan.js';
it('bounds per-run labels and dead effect to disposable named NPC payloads', () => {
  const a = nativeDocumentPlan('0123456789ab'),
    b = nativeDocumentPlan('abcdef012345');
  expect(a.actor.type).toBe('npc');
  expect(a.effect.statuses).toEqual(['dead']);
  expect(a.effect.name).toContain(a.prefix);
  expect(a.page.name).toContain(a.prefix);
  expect(a.actorUpdate['flags.world.task23.-=obsolete']).toBeNull();
  expect(a.prefix).not.toBe(b.prefix);
  expect(() => nativeDocumentPlan('../other')).toThrow();
});
it('tracks exact structured or delayed native text UUIDs and rejects wrong roots/parents', () => {
  const root = 'Actor.0123456789abcdef';
  const effect = `${root}.ActiveEffect.abcdef0123456789`;
  expect(returnedDocumentUuid({ text: `Document created: ${effect}` }, 'ActiveEffect', root)).toBe(
    effect,
  );
  expect(returnedDocumentUuid({ text: '', structured: { uuid: root } }, 'Actor')).toBe(root);
  expect(() => returnedDocumentUuid({ text: effect }, 'Actor')).toThrow();
  expect(() =>
    returnedDocumentUuid({ text: effect }, 'ActiveEffect', 'Actor.aaaaaaaaaaaaaaaa'),
  ).toThrow();
  expect(() =>
    returnedDocumentUuid({ text: '', structured: { uuid: `${root}.other` } }, 'Actor'),
  ).toThrow();
});
it('Undo comparison preserves nested child IDs/content and ignores only lifecycle metadata', () => {
  const before = {
    _id: 'root',
    _stats: { modifiedTime: 1 },
    effects: [{ _id: 'effect', statuses: ['dead'], _stats: { createdTime: 1 } }],
  };
  const restored = {
    ...before,
    _stats: { modifiedTime: 2 },
    effects: [{ ...before.effects[0], _stats: { createdTime: 2 } }],
  };
  expect(undoComparable(restored)).toEqual(undoComparable(before));
  expect(
    undoComparable({ ...restored, effects: [{ ...restored.effects[0], _id: 'different' }] }),
  ).not.toEqual(undoComparable(before));
});

it('requires actual UUID-bound native update diff paths including deletion before readiness', () => {
  const run = '0123456789ab',
    plan = nativeDocumentPlan(run);
  const cards = [
    {
      tool: 'document_update',
      uuid: 'Actor.a',
      rows: [
        {
          path: 'name',
          before: JSON.stringify(plan.actor.name),
          after: JSON.stringify(plan.actorUpdate.name),
        },
        { path: 'flags.world.task23.phase', before: '—', after: '"updated"' },
        { path: 'flags.world.task23.obsolete', before: '"remove"', after: '—' },
      ],
    },
    {
      tool: 'document_update',
      uuid: 'JournalEntry.j.JournalEntryPage.p',
      rows: [
        {
          path: 'text.content',
          before: JSON.stringify(plan.page.text.content),
          after: JSON.stringify(plan.pageUpdate.text.content),
        },
      ],
    },
  ];
  const input = { actor: cards[0]!.uuid, page: cards[1]!.uuid, run };
  expect(() => assertNativeUpdateDiff(cards, input)).not.toThrow();
  expect(() =>
    assertNativeUpdateDiff([{ ...cards[0]!, uuid: 'Actor.other' }, cards[1]!], input),
  ).toThrow('identity');
  expect(() =>
    assertNativeUpdateDiff([{ ...cards[0]!, rows: cards[0]!.rows.slice(0, 2) }, cards[1]!], input),
  ).toThrow('obsolete');
});

it('matches all rendered approval cards to full planned tool/args and refuses historical extras', () => {
  const spec = { name: 'document_create', args: { type: 'Actor', data: '{"name":"nonce"}' } };
  const card = { id: 'a'.repeat(22), tool: spec.name, args: spec.args };
  expect(() => assertNativeApprovalCards([card], [spec])).not.toThrow();
  expect(() =>
    assertNativeApprovalCards(
      [{ ...card, args: { ...card.args, data: '{"name":"old"}' } }],
      [spec],
    ),
  ).toThrow('arguments');
  expect(() => assertNativeApprovalCards([card, { ...card, id: 'b'.repeat(22) }], [spec])).toThrow(
    'count',
  );
});

it('rejects malformed destructive-policy shape before inspecting the GM cell', () => {
  expect(() => nativeDestructivePolicy(null)).toThrow();
  expect(() => nativeDestructivePolicy({ gmAgents: { destructive: 'ask_owner' } })).toThrow();
});

it('requires the exact reviewed five-document eight-audit resume identity, never an arbitrary root', () => {
  const roots = [
    'Actor.aaaaaaaaaaaaaaaa',
    'JournalEntry.jjjjjjjjjjjjjjjj',
    'Item.iiiiiiiiiiiiiiii',
  ];
  const checkpoint = {
    version: 'v14',
    fixtureRun: '0123456789ab',
    userId: 'gm',
    agentId: 'agent',
    roots,
    created: [
      ...roots,
      `${roots[0]}.ActiveEffect.eeeeeeeeeeeeeeee`,
      `${roots[1]}.JournalEntryPage.pppppppppppppppp`,
    ],
    snapshots: roots.map((uuid) => ({ _id: uuid.split('.').at(-1) })),
    audits: Array.from({ length: 8 }, (_, i) => ({
      uuid: `JournalEntry.audit.JournalEntryPage.audit${i}`,
      system: { status: 'ok', userId: 'gm', agentId: 'agent', relayed: false },
    })),
    deleteAudit: { uuid: 'JournalEntry.audit.JournalEntryPage.audit7', id: 'audit7' },
    originalSourceUnavailable: true,
  };
  expect(() => assertNativeResumeCheckpoint(checkpoint)).not.toThrow();
  expect(() => assertNativeResumeCheckpoint({ ...checkpoint, created: roots })).toThrow();
  expect(() => assertNativeResumeCheckpoint({ ...checkpoint, userId: 'other' })).toThrow();
  expect(() =>
    assertNativeResumeCheckpoint({
      ...checkpoint,
      snapshots: [{ _id: 'wrong' }, ...checkpoint.snapshots.slice(1)],
    }),
  ).toThrow();
});

it('requires an explicit exact reviewed bundle pin before executable native work', () => {
  const hash = 'a'.repeat(64);
  expect(() => assertNativeBundleHash(hash, hash)).not.toThrow();
  for (const value of [undefined, '', 'a'.repeat(63), 'A'.repeat(64), 'b'.repeat(64)])
    expect(() => assertNativeBundleHash(hash, value)).toThrow();
});

it('Undo comparison retains ordinary system and flags stats even inside embedded sources', () => {
  const before = [
    {
      _id: 'root',
      _stats: { modifiedTime: 1 },
      system: { _stats: { value: 1 }, effects: [{ _stats: { ordinary: 1 } }] },
      flags: { custom: { _stats: { value: 1 } } },
      effects: [{ _id: 'child', _stats: { modifiedTime: 1 }, system: { _stats: { value: 1 } } }],
    },
  ];
  for (const change of [
    (v: typeof before) => {
      v[0]!.system._stats.value = 2;
    },
    (v: typeof before) => {
      v[0]!.system.effects[0]!._stats.ordinary = 2;
    },
    (v: typeof before) => {
      v[0]!.flags.custom._stats.value = 2;
    },
    (v: typeof before) => {
      v[0]!.effects[0]!.system._stats.value = 2;
    },
  ]) {
    const changed = structuredClone(before);
    change(changed);
    expect(undoComparable(changed)).not.toEqual(undoComparable(before));
  }
  const lifecycleOnly = structuredClone(before);
  lifecycleOnly[0]!._stats.modifiedTime = 2;
  lifecycleOnly[0]!.effects[0]!._stats.modifiedTime = 2;
  expect(undoComparable(lifecycleOnly)).toEqual(undoComparable(before));
});
