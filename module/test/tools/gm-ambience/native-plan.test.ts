import { describe, it, expect } from 'vitest';
import { task25Calls, task25FixtureData, task25ProofPins } from './native-plan.js';
import {
  assertTask25Draw,
  assertTask25Completion,
  assertTask25PrivateChat,
} from './native-checks.js';
import { capturedCallAudit } from '../gm-scene/native-plan.js';
const run = '012345abcdef',
  reference = 'Compendium.public.items.Item.dagger';
describe('Task25 exact approved native plan', () => {
  it('keeps seven calls with muted play/next before stopped-only volume and Player1-only delivery', () => {
    const fixture = task25FixtureData(run, reference),
      calls = task25Calls({ table: 'RollTable.t', playlist: 'Playlist.p', player: 'p1' }, run);
    expect(calls).toHaveLength(7);
    expect(fixture.table.results.map((r) => r.range)).toEqual([
      [1, 2],
      [1, 2],
    ]);
    expect(fixture.playlist.sounds.every((s) => s.volume === 0 && s.repeat && !s.playing)).toBe(
      true,
    );
    expect(calls.slice(2, 6).map((c) => c.args.action)).toEqual([
      'play',
      'next',
      'stop',
      'set_volume',
    ]);
    expect(calls[6]!.args.users).toEqual(['p1']);
  });
  it('rejects a source mismatch or missing/duplicate result and wrong chat presence', () => {
    const results = [
      { text: `ag-task25-${run} & text` },
      { text: `ag-task25-${run} reference`, documentUuid: reference },
    ];
    expect(() => assertTask25Draw({ results }, reference, run, false)).not.toThrow();
    expect(() =>
      assertTask25Draw({ results, messageUuid: 'ChatMessage.c' }, reference, run, true),
    ).not.toThrow();
    expect(() => assertTask25Draw({ results }, reference + 'x', run, false)).toThrow();
    expect(() =>
      assertTask25Draw({ results: [results[0], results[0]] }, reference, run, false),
    ).toThrow();
    expect(() => assertTask25Draw({ results }, reference, run, true)).toThrow();
  });
  it('binds retained audits to exact UUID and entry identity rather than trusting a count', () => {
    const call = task25Calls(
        { table: 'RollTable.t', playlist: 'Playlist.p', player: 'p1' },
        run,
      )[0]!,
      identity = { userId: 'gm', agentId: 'agent' },
      row = {
        uuid: 'JournalEntry.j.JournalEntryPage.a',
        entryId: 'call1',
        ...identity,
        tool: call.tool,
        args: JSON.stringify(call.args),
        status: 'ok',
      };
    expect(capturedCallAudit([row], [], identity, call, row)).toBe(row);
    expect(() =>
      capturedCallAudit([{ ...row, entryId: 'replacement' }], [], identity, call, row),
    ).toThrow();
    expect(() => capturedCallAudit([], [], identity, call, row)).toThrow();
  });
});

describe('Task25 actual text-only pending completion', () => {
  const input = {
    result: {
      text: `ag-task25-${run} & text\nag-task25-${run} reference`,
      structured: undefined,
      pendingCompletion: true,
    },
    table: {
      results: [
        { _id: 'a', type: 'text', description: `<b>ag-task25-${run} &amp; text</b>` },
        {
          _id: 'b',
          type: 'document',
          description: `ag-task25-${run} reference`,
          documentUuid: reference,
        },
      ],
    },
    resultIds: ['a', 'b'],
    reference,
    run,
    chat: false,
    audit: { targets: [] as Array<{ uuid: string; existed: boolean }> },
  };
  it('accepts the actual approval_status text-only result shape with exact native sources', () => {
    expect(() => assertTask25Completion(input)).not.toThrow();
  });
  it('rejects wrong terminal lines, changed source reference and missing/duplicate captured IDs', () => {
    expect(() =>
      assertTask25Completion({ ...input, result: { ...input.result, text: 'wrong' } }),
    ).toThrow();
    expect(() => assertTask25Completion({ ...input, reference: reference + 'x' })).toThrow();
    expect(() => assertTask25Completion({ ...input, resultIds: ['a', 'a'] })).toThrow();
  });
  it('requires one exact correlated chat target and native identity for the pending chat draw', () => {
    const withChat = {
      ...input,
      chat: true,
      nativeChatUuid: 'ChatMessage.c',
      audit: { targets: [{ uuid: 'ChatMessage.c', existed: false }] },
    };
    expect(() => assertTask25Completion(withChat)).not.toThrow();
    expect(() => assertTask25Completion({ ...withChat, audit: { targets: [] } })).toThrow();
    expect(() =>
      assertTask25Completion({
        ...withChat,
        audit: { targets: [...withChat.audit.targets, ...withChat.audit.targets] },
      }),
    ).toThrow();
    expect(() =>
      assertTask25Completion({ ...withChat, nativeChatUuid: 'ChatMessage.foreign' }),
    ).toThrow();
  });
  it('keeps immediate completion strict instead of silently substituting native data', () => {
    expect(() =>
      assertTask25Completion({ ...input, result: { ...input.result, pendingCompletion: false } }),
    ).toThrow();
  });
});

describe('Native blind-roll placeholder privacy', () => {
  const placeholder = {
    gm: false,
    run,
    reference,
    messages: [{ visible: true, isContentVisible: false }],
    chatDOM: {
      present: true,
      aiMarker: true,
      text: 'dev-gm rolled privately ??? ?',
      formulas: ['???'],
      totals: ['?'],
      tooltip: '',
    },
  };
  it('allows an actual native visible placeholder while requiring hidden content', () => {
    expect(() => assertTask25PrivateChat(placeholder)).not.toThrow();
  });
  it('rejects actual content visibility, nonce/reference text and exposed native dice details', () => {
    expect(() =>
      assertTask25PrivateChat({
        ...placeholder,
        messages: [{ visible: true, isContentVisible: true }],
      }),
    ).toThrow();
    expect(() =>
      assertTask25PrivateChat({
        ...placeholder,
        chatDOM: { ...placeholder.chatDOM, text: `ag-task25-${run} & text` },
      }),
    ).toThrow();
    expect(() =>
      assertTask25PrivateChat({
        ...placeholder,
        chatDOM: { ...placeholder.chatDOM, text: reference },
      }),
    ).toThrow();
    expect(() =>
      assertTask25PrivateChat({
        ...placeholder,
        chatDOM: { ...placeholder.chatDOM, formulas: ['1d2'] },
      }),
    ).toThrow();
    expect(() =>
      assertTask25PrivateChat({
        ...placeholder,
        chatDOM: { ...placeholder.chatDOM, totals: ['2'] },
      }),
    ).toThrow();
    expect(() =>
      assertTask25PrivateChat({
        ...placeholder,
        chatDOM: { ...placeholder.chatDOM, tooltip: '1d2 = 2' },
      }),
    ).toThrow();
  });
  it('retains real result content and AI badge requirements for GM', () => {
    const gm = {
      ...placeholder,
      gm: true,
      messages: [{ isContentVisible: true }],
      chatDOM: {
        ...placeholder.chatDOM,
        text: `ag-task25-${run} & text ag-task25-${run} reference`,
      },
    };
    expect(() => assertTask25PrivateChat(gm)).not.toThrow();
    expect(() =>
      assertTask25PrivateChat({ ...gm, chatDOM: { ...gm.chatDOM, aiMarker: false } }),
    ).toThrow();
  });
});

it('validates reusable explicit source/build pins without widening opt-in authority', () => {
  expect(task25ProofPins().source).toHaveLength(40);
  expect(task25ProofPins().bundle).toHaveLength(64);
  expect(() => task25ProofPins('unknown', '0'.repeat(64))).toThrow();
  expect(() => task25ProofPins('0'.repeat(40), 'bad')).toThrow();
});
