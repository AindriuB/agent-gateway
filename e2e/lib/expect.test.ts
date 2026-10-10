import { describe, expect, it } from 'vitest';
import { FIXTURE } from '../fixtures/spec.js';
import {
  chatProblems,
  notFoundProblems,
  overlapProblems,
  playerPublicEntryProblems,
  searchProblems,
  toolListProblems,
  worldInfoProblems,
  type ChatMsg,
} from './expect.js';

const { text, names } = FIXTURE;
const m = (content: string, extra: Partial<ChatMsg> = {}): ChatMsg => ({ content, ...extra });
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
  m('', { rollFormula: '7d6', rollTotal: 20 }),
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
  it('player view passes', () => expect(chatProblems('player', playerChat)).toEqual([]));
  it('player must not see the GM whisper, the NPC secret or the blind roll', () => {
    expect(chatProblems('player', [...playerChat, m(text.gmWhisper)])).toContain(
      'GM whisper visible',
    );
    expect(chatProblems('player', [...playerChat, m(`${text.npcSecret}`)])).toContain(
      'NPC secret visible',
    );
    expect(chatProblems('player', [...playerChat, m('', { rollFormula: '7d6' })])).toContain(
      'blind roll visible',
    );
  });
  it('player must keep the own-character secret', () => {
    expect(
      chatProblems(
        'player',
        playerChat.map((x) => m(x.content.replace(text.ownSecret, ''))),
      ),
    ).toContain('own-character secret was stripped');
  });
  it('gm view passes and needs everything', () => {
    expect(chatProblems('gm', gmChat)).toEqual([]);
    expect(chatProblems('gm', playerChat).length).toBeGreaterThanOrEqual(3);
  });
});

describe('small checks', () => {
  it('overlapProblems', () => {
    expect(overlapProblems(['a', 'b'], ['c'])).toEqual([]);
    expect(overlapProblems(['a', 'b'], ['b'])).toHaveLength(1);
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
    expect(worldInfoProblems('player', ok, exp)).toEqual(['role is GAMEMASTER']);
    expect(worldInfoProblems('gm', { ...ok, systemId: 'dnd5e' }, exp)).toEqual(['system is dnd5e']);
  });
  it('toolListProblems', () => {
    expect(toolListProblems(['a'], ['a', 'b'], ['b'])).toEqual([]);
    expect(toolListProblems(['a', 'b'], ['a', 'b'], ['b'])).toEqual(['player has GM-only tool b']);
    expect(toolListProblems(['c'], ['a'], [])).toEqual(['player tool c is not a GM tool']);
  });
});
