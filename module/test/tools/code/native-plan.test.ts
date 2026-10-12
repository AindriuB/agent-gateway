import { expect, it } from 'vitest';
import {
  task26Plan,
  task26ProofPins,
  assertTask26SourceCard,
  assertTask26Return,
} from './native-plan.js';
it('pins two read-only sources and one fresh bounded script Macro', () => {
  const p = task26Plan('123456789abc', 14, 'Macro.fixture');
  expect(p.calls).toHaveLength(2);
  expect(p.fixture.command).toBe(p.calls[0]!.source);
  for (const c of p.calls)
    expect(c.source).not.toMatch(/\.create\(|\.update\(|\.delete\(|notifications|socket|settings/);
});
it('requires exact full source and no session control before human READY', () => {
  const c = task26Plan('123456789abc', 13, 'Macro.fixture').calls[0]!;
  const card = {
    tool: c.tool,
    args: { ...c.args, source: c.source },
    source: c.source,
    session: false,
  };
  expect(() => assertTask26SourceCard(card, c)).not.toThrow();
  for (const bad of [
    { ...card, source: card.source.slice(0, -1) },
    { ...card, args: c.args },
    { ...card, session: true },
  ])
    expect(() => assertTask26SourceCard(bad, c)).toThrow();
});
it('keeps real pending text-only results distinct from strict immediate structure', () => {
  const expected = '{"value":1}';
  expect(() =>
    assertTask26Return({ text: expected, failed: false, pending: true }, expected),
  ).not.toThrow();
  expect(() =>
    assertTask26Return({ text: expected, failed: false, pending: false }, expected),
  ).toThrow();
  expect(() =>
    assertTask26Return({ text: 'wrong', failed: false, pending: true }, expected),
  ).toThrow();
  expect(() =>
    assertTask26Return(
      {
        text: expected,
        failed: false,
        pending: false,
        structured: { result: expected, truncated: false },
      },
      expected,
    ),
  ).not.toThrow();
});

it('rejects malformed public build overrides before native setup', () => {
  expect(task26ProofPins().source).toHaveLength(40);
  expect(task26ProofPins('a'.repeat(40), 'b'.repeat(64))).toEqual({
    source: 'a'.repeat(40),
    bundle: 'b'.repeat(64),
  });
  for (const [source, bundle] of [
    ['short', 'b'.repeat(64)],
    ['a'.repeat(40), 'wrong'],
    ['A'.repeat(40), 'b'.repeat(64)],
  ])
    expect(() => task26ProofPins(source, bundle)).toThrow();
});
