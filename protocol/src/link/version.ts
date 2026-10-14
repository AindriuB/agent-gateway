import type { ErrorCode } from './errors.js';

/** v7 adds the GM-vouched pairing flow (pairingChallenge, attest) and the welcome admin flag. */
export const PROTOCOL_VERSION = '7.0.0';

export type CompatResult = { ok: true } | { ok: false; code: ErrorCode; message: string };

function major(v: string): number | null {
  const m = /^(\d+)\.\d+\.\d+/.exec(v);
  return m ? Number(m[1]) : null;
}

/** Same major is compatible; a differing major is refused with an actionable message. */
export function checkCompat(local: string, remote: string): CompatResult {
  const l = major(local);
  const r = major(remote);
  if (l === null || r === null) {
    return {
      ok: false,
      code: 'PROTOCOL_MAJOR_MISMATCH',
      message: `Cannot read protocol version (local ${local}, remote ${remote}). Update the older side so both speak the same protocol.`,
    };
  }
  if (l === r) return { ok: true };
  const upgrade = r > l ? 'local side' : 'remote side';
  return {
    ok: false,
    code: 'PROTOCOL_MAJOR_MISMATCH',
    message: `Protocol major version mismatch: local ${local}, remote ${remote}. Upgrade the ${upgrade} (the one on the older version) so both share the same major version.`,
  };
}
