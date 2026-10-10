import { describe, expect, it } from 'vitest';
import { FIXTURE } from '../fixtures/spec.js';
import {
  chatProblems,
  notFoundProblems,
  overlapProblems,
  proseLines,
  playerPublicEntryProblems,
  searchProblems,
  toolListProblems,
  worldInfoProblems,
  type ChatMsg,
} from './expect.js';

const { text, names } = FIXTURE;
const m = (content: string, extra: Partial<ChatMsg> = {}): ChatMsg => ({ content, ...extra });
const BLIND = 'aB7D6xyz12345678';
const playerChat = [
  m(text.publicMessage),
  m(`${text.npcMessage}`),
  m(text.playerWhisper),
  m(`${text.ownMessage} ${text.ownSecret}`),
];
const gmChat = [
  ...playerChat.slice(0, 1),
  m(`${text.npcMessage} ${text.npcSecret}`),
  m(text.playerWhisper),
  m(`${text.ownMessage} ${text.ownSecret}`),
  m(text.gmWhisper),
  m('', { id: BLIND, rollFormula: '7d6', rollTotal: 20 }),
];

describe('searchProblems', () => {
  it('player sees only the public entry', () => {
    expect(searchProblems('player', [names.publicEntry, 'other'])).toEqual([]);
    expect(searchProblems('player', [names.publicEntry, names.hiddenEntry])).toEqual([
      `unexpected ${names.hiddenEntry}`,
    ]);
    expect(searchProblems('player', [])).toEqual([`missing ${names.publicEntry}`]);
  });
  it('gm sees all three', () => {
    expect(
      searchProblems('gm', [names.publicEntry, names.hiddenEntry, names.limitedEntry]),
    ).toEqual([]);
    expect(searchProblems('gm', [names.publicEntry])).toHaveLength(2);
  });
});

describe('notFoundProblems', () => {
  it('accepts INVALID_ARGS not found and rejects FORBIDDEN', () => {
    expect(
      notFoundProblems({ isError: true, text: 'INVALID_ARGS: Document "x" not found' }),
    ).toEqual([]);
    expect(
      notFoundProblems({ isError: true, text: 'FORBIDDEN: not found' }).length,
    ).toBeGreaterThan(0);
    expect(notFoundProblems({ isError: false, text: 'ok' }).length).toBeGreaterThan(0);
  });
});

describe('playerPublicEntryProblems', () => {
  const good = `${text.publicPageVisible}\n${text.markdownVisible}\n**ownership.yours**: 2`;
  it('accepts the expected view', () => expect(playerPublicEntryProblems(good)).toEqual([]));
  it.each([
    [`${good}\n${text.gmPage}`],
    [`${good}\n${text.publicPageSecret}`],
    [`${good}\n${text.markdownSecret}`],
    [`${good}\npages.2.text.markdown: x`],
    [good.replace(': 2', ': 3')],
    [`${good}\nownership.default: 2`],
  ])('rejects a leak: %#', (content) => {
    expect(playerPublicEntryProblems(content).length).toBeGreaterThan(0);
  });
});

describe('chatProblems', () => {
  it('an ordinary 7d6 roll in another message is not the blind roll', () => {
    const other = m('Public fireball', {
      id: 'publicMsg0000001',
      rollFormula: '7d6',
      rollTotal: 24,
    });
    expect(chatProblems('player', [...playerChat, other], BLIND)).toEqual([]);
    // For the GM, a 7d6 roll in another message does not stand in for the blind roll.
    const gmNoBlind = gmChat.filter((x) => x.id !== BLIND);
    expect(chatProblems('gm', [...gmNoBlind, other], BLIND)).toContain('missing the blind roll');
  });
  it('player view passes', () => expect(chatProblems('player', playerChat, BLIND)).toEqual([]));
  it('player must not see the GM whisper, the NPC secret or the blind roll', () => {
    expect(chatProblems('player', [...playerChat, m(text.gmWhisper)], BLIND)).toContain(
      'GM whisper visible',
    );
    expect(chatProblems('player', [...playerChat, m(`${text.npcSecret}`)], BLIND)).toContain(
      'NPC secret visible',
    );
    expect(
      chatProblems('player', [...playerChat, m('', { id: BLIND, rollFormula: '7d6' })], BLIND),
    ).toContain('blind roll visible');
  });
  it('player must keep the own-character secret', () => {
    expect(
      chatProblems(
        'player',
        playerChat.map((x) => m(x.content.replace(text.ownSecret, ''))),
        BLIND,
      ),
    ).toContain('own-character secret was stripped');
  });
  it('gm view passes and needs everything', () => {
    expect(chatProblems('gm', gmChat, BLIND)).toEqual([]);
    expect(chatProblems('gm', playerChat, BLIND).length).toBeGreaterThanOrEqual(3);
  });
});

describe('small checks', () => {
  it('overlapProblems compares leading prose and ignores tables and fences', () => {
    const header = '| Name | Level | Description of the thing here |';
    const sep = '| ---- | ----- | ----------------------------- |';
    const fence = '```text with enough characters to pass the length filter';
    const p1 = 'The first paragraph of the entry, long enough to be distinctive.';
    const p2 = 'A second paragraph that only appears on the first page of it.';
    const p3 = 'Fresh prose that begins the second page of the same entry.';
    const first = [p1, header, sep, fence, p2].join('\n');
    // Repeated header, separator and reopened fence are by design.
    expect(overlapProblems(first, [header, sep, fence, p3].join('\n'))).toEqual([]);
    expect(overlapProblems(first, [p2, p3].join('\n'))).toHaveLength(1);
    expect(overlapProblems(first, [header, sep].join('\n'))).toEqual([
      'second page has no prose to compare',
    ]);
  });
  it('proseLines drops short lines, table rows and fences', () => {
    expect(proseLines('short\n| a table row that is certainly longer than forty chars |')).toEqual(
      [],
    );
  });
  it('anchors the ownership check to the top-level line', () => {
    const base = `${text.publicPageVisible}
${text.markdownVisible}
`;
    expect(
      playerPublicEntryProblems(`${base}pages[0].ownership.yours: 3
**ownership.yours**: 2`),
    ).toEqual([]);
    expect(playerPublicEntryProblems(`${base}pages[0].ownership.yours: 2`)).toContain(
      'ownership.yours is not 2',
    );
  });
  it('treats the blind message marker as a blind-roll leak for a player', () => {
    expect(chatProblems('player', [...playerChat, m(text.blindMessage)], BLIND)).toContain(
      'blind roll visible',
    );
  });
  it('worldInfoProblems', () => {
    const exp = { world: 'test-world', user: 'dev-gm' };
    const ok = {
      worldId: 'test-world',
      systemId: 'pf2e',
      userName: 'dev-gm',
      userRole: 'GAMEMASTER',
    };
    expect(worldInfoProblems('gm', ok, exp)).toEqual([]);
    expect(worldInfoProblems('gm', { ...ok, userName: 'Dev-GM' }, exp)).toEqual([]);
    expect(worldInfoProblems('player', ok, exp)).toEqual(['role is GAMEMASTER']);
    expect(worldInfoProblems('gm', { ...ok, systemId: 'dnd5e' }, exp)).toEqual(['system is dnd5e']);
  });
  it('toolListProblems', () => {
    expect(toolListProblems(['a'], ['a', 'b'], ['b'])).toEqual([]);
    expect(toolListProblems(['a', 'b'], ['a', 'b'], ['b'])).toEqual(['player has GM-only tool b']);
    expect(toolListProblems(['c'], ['a'], [])).toEqual(['player tool c is not a GM tool']);
  });
});
