import { describe, expect, it } from 'vitest';
import { HIDDEN_STRINGS, leakMatchers } from '../fixtures/manifest.js';
import { LeakChecker, LeakError } from './leak.js';

const blind = { total: 23, messageId: 'aB7D6xyz12345678' };
const base = () => leakMatchers().length;

describe('LeakChecker', () => {
  it('passes clean results and counts them', () => {
    const c = new LeakChecker(leakMatchers(blind));
    c.check('chat_read', {}, { content: [{ type: 'text', text: 'hello ag-test-public' }] });
    c.check('world_info', {}, { structuredContent: { ts: 1700000000023 } });
    expect(c.summary()).toEqual({ results: 2, strings: base() + 5, hits: 0 });
    expect(c.line()).toBe(`leak check: 2 results x ${base() + 5} strings, 0 hits`);
  });

  it.each(HIDDEN_STRINGS)('catches %s', (s) => {
    const c = new LeakChecker(leakMatchers());
    expect(() =>
      c.check('document_get', { uuid: 'u' }, { text: `x ${s.toUpperCase()} y` }),
    ).toThrow(LeakError);
    expect(c.summary().hits).toBe(1);
  });

  it('names the tool, arguments and string', () => {
    const c = new LeakChecker(leakMatchers(blind));
    expect(() =>
      c.check(
        'chat_read',
        { limit: 5 },
        { structuredContent: { messages: [{ id: blind.messageId, rollFormula: '7d6' }] } },
      ),
    ).toThrow(
      /tool chat_read with arguments {"limit":5} returned hidden string "rollFormula 7d6 \(blind message\)"/,
    );
  });

  it('ties the blind roll to its message, not to a bare 7d6 or a bare number', () => {
    const c = new LeakChecker(leakMatchers(blind));
    c.check('document_get', {}, { text: 'A dragon breathes for 7d6 fire damage.' });
    c.check(
      'chat_read',
      {},
      { structuredContent: { id: 'x7D6y', rollFormula: '1d20', rollTotal: 21 } },
    );
    c.check('chat_read', {}, { structuredContent: { id: 'a23b', timestamp: 1700000230000 } });
    c.check('chat_read', {}, { text: '[roll 1d20 = 23] (2026-01-01, abc)' });
    expect(c.summary().hits).toBe(0);
  });

  it.each([
    [
      'structured formula',
      { structuredContent: { messages: [{ id: 'aB7D6xyz12345678', rollFormula: '7d6' }] } },
    ],
    [
      'rendered roll',
      { content: [{ type: 'text', text: '[roll 7d6 = 4] (2026-01-01, aB7D6xyz12345678)' }] },
    ],
    [
      'total',
      { content: [{ type: 'text', text: '[roll 7d6 = 23] (2026-01-01, aB7D6xyz12345678)' }] },
    ],
    ['structured total', { structuredContent: { id: 'aB7D6xyz12345678', rollTotal: 23 } }],
    ['message id', { structuredContent: { id: 'aB7D6xyz12345678' } }],
    [
      'rendered id',
      { content: [{ type: 'text', text: '(2026-01-01T00:00:00Z, aB7D6xyz12345678)' }] },
    ],
    ['content marker', { content: [{ type: 'text', text: 'ag-test blind roll' }] }],
  ])('catches the blind roll via %s', (_n, result) => {
    const c = new LeakChecker(leakMatchers(blind));
    expect(() => c.check('chat_read', {}, result)).toThrow(LeakError);
  });

  it('does not flag an ordinary 7d6 roll in another message', () => {
    const c = new LeakChecker(leakMatchers(blind));
    c.check(
      'chat_read',
      {},
      {
        structuredContent: {
          messages: [{ id: 'publicMsg0000001', rollFormula: '7d6', rollTotal: 23 }],
        },
      },
    );
    c.check(
      'chat_read',
      {},
      {
        content: [
          {
            type: 'text',
            text: '**dev-gm** [roll 7d6 = 23] (2026-01-01T00:00:00Z, publicMsg0000001)',
          },
        ],
      },
    );
    expect(c.summary().hits).toBe(0);
  });

  it('has no blind-roll matchers without the message id', () => {
    // (The content marker "ag-test blind roll" is a hidden string of that message, and stays.)
    expect(leakMatchers({ total: 23 }).map((x) => x.label)).toEqual(
      leakMatchers().map((x) => x.label),
    );
    expect(leakMatchers().some((x) => /7d6|blind message|blind roll total/.test(x.label))).toBe(
      false,
    );
  });

  describe('the blind roll total matcher', () => {
    const totalMatcher = () => {
      const m = leakMatchers(blind).find((x) => x.label === 'blind roll total 23');
      if (!m) throw new Error('total matcher missing');
      return m;
    };
    const hay = (r: unknown) => JSON.stringify(r);

    it('does not flag another message with the same total', () => {
      const m = totalMatcher();
      expect(m.test(hay({ structuredContent: { id: 'publicMsg0000001', rollTotal: 23 } }))).toBe(
        false,
      );
      expect(
        m.test(
          hay({ structuredContent: { messages: [{ id: 'publicMsg0000001', rollTotal: 23 }] } }),
        ),
      ).toBe(false);
      expect(
        m.test(hay({ text: '[roll 2d12 = 23] (2026-01-01T00:00:00Z, publicMsg0000001)' })),
      ).toBe(false);
    });

    it('flags the total inside the seeded message, structured or rendered', () => {
      const m = totalMatcher();
      expect(
        m.test(
          hay({ structuredContent: { messages: [{ id: 'aB7D6xyz12345678', rollTotal: 23 }] } }),
        ),
      ).toBe(true);
      expect(
        m.test(
          hay({
            content: [
              {
                type: 'text',
                text: JSON.stringify({ messages: [{ id: 'aB7D6xyz12345678', rollTotal: 23 }] }),
              },
            ],
          }),
        ),
      ).toBe(true);
      expect(
        m.test(hay({ text: '[roll 7d6 = 23] (2026-01-01T00:00:00Z, aB7D6xyz12345678)' })),
      ).toBe(true);
    });

    it('needs the message id; a total alone adds no matcher', () => {
      expect(leakMatchers({ total: 23 }).some((x) => x.label.startsWith('blind roll total'))).toBe(
        false,
      );
    });
  });

  it('does not flag the strings a player may see', () => {
    const c = new LeakChecker(leakMatchers(blind));
    c.check('x', {}, { text: 'ag-test-public, ag-test public message, ag-test OWN SECRET' });
  });
});
