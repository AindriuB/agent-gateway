import { describe, expect, it } from 'vitest';
import { parsePairingInput } from '../../src/link/invite-string.js';

const CODE = 'ABCD-EFGH-JKMN';

describe('parsePairingInput: accepted', () => {
  it('parses the gateway output format', () => {
    expect(parsePairingInput(`wss://gw.aindriub.app/link#${CODE}`)).toEqual({
      kind: 'invite',
      url: 'wss://gw.aindriub.app/link',
      code: CODE,
    });
  });
  it('upper-cases a lower-case code', () => {
    expect(parsePairingInput(`wss://gw/link#${CODE.toLowerCase()}`)).toEqual({
      kind: 'invite',
      url: 'wss://gw/link',
      code: CODE,
    });
  });
  it('trims surrounding whitespace', () => {
    expect(parsePairingInput(`  wss://gw/link#${CODE}\n`)).toMatchObject({ kind: 'invite' });
  });
  it.each(['ws://localhost:8080/link', 'ws://127.0.0.1:7420/link', 'ws://[::1]:7420/link'])(
    'accepts ws on loopback %s',
    (u) => {
      expect(parsePairingInput(`${u}#${CODE}`)).toMatchObject({ kind: 'invite' });
    },
  );
  it('returns a url with no fragment', () => {
    const r = parsePairingInput(`wss://gw:8443/link#${CODE}`);
    expect(r).toEqual({ kind: 'invite', url: 'wss://gw:8443/link', code: CODE });
  });
  it('passes a bare code through, trimmed', () => {
    expect(parsePairingInput(' abc ')).toEqual({ kind: 'code', code: 'abc' });
    expect(parsePairingInput(CODE)).toEqual({ kind: 'code', code: CODE });
  });
});

describe('parsePairingInput: rejected', () => {
  const bad: Array<[string, string]> = [
    ['javascript scheme', `javascript:alert(1)#${CODE}`],
    ['data scheme', 'data:text/html,<script>alert(1)</script>#ABCD-EFGH-JKMN'],
    ['https scheme', `https://gw/link#${CODE}`],
    ['ws to non-loopback', `ws://gw.example.com/link#${CODE}`],
    ['ws to a loopback lookalike', `ws://localhost.evil.com/link#${CODE}`],
    ['credentials', `wss://u:p@gw/link#${CODE}`],
    ['username only', `wss://u@gw/link#${CODE}`],
    ['query', `wss://gw/link?x=1#${CODE}`],
    ['empty query', `wss://gw/link?#${CODE}`],
    ['wrong path', `wss://gw/other#${CODE}`],
    ['root path', `wss://gw/#${CODE}`],
    ['no fragment', 'wss://gw/link'],
    ['empty fragment', 'wss://gw/link#'],
    ['script fragment', 'wss://gw/link#<script>'],
    ['double fragment', `wss://gw/link#${CODE}#x`],
    ['whitespace in code', 'wss://gw/link#ABCD EFGH-JKMN'],
    ['newline in code', 'wss://gw/link#ABCD-EFGH\n-JKMN'],
    ['tab in code', 'wss://gw/link#ABCD-EFGH\t-JKMN'],
    ['NUL in code', 'wss://gw/link#ABCD-EFGH-JK\u0000MN'],
    ['newline inside address', `wss://gw\n/link#${CODE}`],
    ['code with ambiguous letters', 'wss://gw/link#ABCD-EFGH-JKMO'],
    ['too long', `wss://${'a'.repeat(2049 - `wss://.com/link#${CODE}`.length)}.com/link#${CODE}`],
    ['unparseable', 'wss://:::/link#ABCD-EFGH-JKMN'],
    ['bare code with colon', 'abc:def'],
    ['bare text with a fragment mark', 'ABCD#EFGH'],
    ['bare code with whitespace inside', 'abc def'],
    ['bare code too long', 'A'.repeat(65)],
    ['bare code with NUL', 'ab\u0000c'],
    ['empty', '   '],
  ];
  it.each(bad)('%s is invalid', (_n, input) => {
    if (_n === 'too long') expect(input.length).toBe(2049);
    const r = parsePairingInput(input);
    expect(r.kind).toBe('invalid');
  });

  it('a reason is a fixed word that never echoes the input', () => {
    const secret = 'SECRETsecret';
    for (const [, input] of bad) {
      const r = parsePairingInput(`${input}${secret}`);
      if (r.kind !== 'invalid') continue;
      expect(r.reason).toMatch(/^[a-z-]+$/);
      expect(r.reason).not.toContain(secret);
    }
    for (const input of [`wss://gw/link#${secret}`, `https://${secret}/link#${CODE}`]) {
      const r = parsePairingInput(input);
      expect(r).toMatchObject({ kind: 'invalid' });
      expect(JSON.stringify(r)).not.toContain(secret);
    }
  });
});
