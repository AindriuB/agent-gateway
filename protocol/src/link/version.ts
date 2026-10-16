import type { ErrorCode } from './errors.js';

/**
 * v7 adds the GM-vouched pairing flow (pairingChallenge, attest) and the welcome admin flag.
 * 7.1 adds the optional `images` array on `result` frames.
 */
export const PROTOCOL_VERSION = '7.1.0';

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

/** True when `version` (major.minor.patch) is at least `min`; an unreadable version is not. */
export function protocolAtLeast(version: string | null, min: string): boolean {
  const parse = (v: string): number[] | null => {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const a = version === null ? null : parse(version);
  const b = parse(min);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return true;
}
