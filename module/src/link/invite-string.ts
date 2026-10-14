import { isLoopbackHost, MAX_GATEWAY_URL } from './gateway-url.js';

/** Fixed words only; a reason never carries any of the input. */
export type InviteProblem =
  'empty' | 'too-long' | 'bad-characters' | 'bad-address' | 'bad-scheme' | 'bad-path' | 'bad-code';

export type PairingInput =
  | { kind: 'invite'; url: string; code: string }
  | { kind: 'code'; code: string }
  | { kind: 'invalid'; reason: InviteProblem };

const CODE_PATTERN = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;
const BAD_CHARS = /[\s\u0000-\u001f\u007f]/;
const MAX_BARE_CODE = 64;

const invalid = (reason: InviteProblem): PairingInput => ({ kind: 'invalid', reason });

/**
 * What a player pasted: an invite string `wss://<host>/link#<CODE>`, or a bare code. Anything
 * containing `:` or `#` must be a valid invite string; a bare code is passed through trimmed.
 */
export function parsePairingInput(text: string): PairingInput {
  const input = text.trim();
  if (input === '') return invalid('empty');
  if (!input.includes(':') && !input.includes('#')) {
    if (input.length > MAX_BARE_CODE) return invalid('too-long');
    if (BAD_CHARS.test(input)) return invalid('bad-characters');
    return { kind: 'code', code: input };
  }
  if (input.length > MAX_GATEWAY_URL) return invalid('too-long');
  // URL parsing drops tabs and newlines, so refuse them first.
  if (BAD_CHARS.test(input)) return invalid('bad-characters');
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return invalid('bad-address');
  }
  if (u.protocol !== 'wss:' && !(u.protocol === 'ws:' && isLoopbackHost(u.hostname)))
    return invalid('bad-scheme');
  if (u.username || u.password) return invalid('bad-address');
  const hashAt = input.indexOf('#');
  const beforeHash = hashAt === -1 ? input : input.slice(0, hashAt);
  if (u.search || beforeHash.includes('?')) return invalid('bad-address');
  if (u.pathname !== '/link') return invalid('bad-path');
  const code = u.hash.slice(1).toUpperCase();
  if (!CODE_PATTERN.test(code)) return invalid('bad-code');
  return { kind: 'invite', url: `${u.protocol}//${u.host}${u.pathname}`, code };
}
