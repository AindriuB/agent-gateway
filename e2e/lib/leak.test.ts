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
    expect(c.summary()).toEqual({ results: 2, strings: base() + 3, hits: 0 });
    expect(c.line()).toBe(`leak check: 2 results x ${base() + 3} strings, 0 hits`);
  });

  it.each(HIDDEN_STRINGS)('catches %s', (s) => {
    const c = new LeakChecker(leakMatchers());
    expect(() =>
      c.check('document_get', { uuid: 'u' }, { text: `x ${s.toUpperCase()} y` }),
    ).toThrow(LeakError);
    expect(c.summary().hits).toBe(1);
  });

  it('names the tool, arguments and string', () => {
    const c = new LeakChecker(leakMatchers());
    expect(() =>
      c.check('chat_read', { limit: 5 }, { structuredContent: { rollFormula: '7d6' } }),
    ).toThrow(/tool chat_read with arguments {"limit":5} returned hidden string "rollFormula 7d6"/);
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
    ['structured formula', { structuredContent: { rollFormula: '7d6' } }],
    ['rendered roll', { content: [{ type: 'text', text: 'x [roll 7d6 = 4] y' }] }],
    ['total', { content: [{ type: 'text', text: 'x [roll 7d6 = 23] y' }] }],
    ['structured total', { structuredContent: { rollTotal: 23 } }],
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

  it('does not flag the strings a player may see', () => {
    const c = new LeakChecker(leakMatchers(blind));
    c.check('x', {}, { text: 'ag-test-public, ag-test public message, ag-test OWN SECRET' });
  });
});
