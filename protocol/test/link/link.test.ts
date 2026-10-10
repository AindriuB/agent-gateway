import { describe, expect, it } from 'vitest';
import {
  ErrorCode,
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  checkCompat,
  parseLinkMessage,
  type LinkMessage,
} from '../../src/link/index.js';

const world = { id: 'w', title: 'W', system: 'dnd5e', systemVersion: '5.0.0' };
const user = { id: 'u', name: 'GM', role: 4, isGM: true };
const hello = {
  type: 'hello',
  protocolVersion: PROTOCOL_VERSION,
  moduleVersion: '0.1.0',
  foundryVersion: '14.0',
  world,
  user,
};

const samples: LinkMessage[] = [
  { ...hello, auth: { kind: 'pairingCode', code: 'ABCD-1234' } } as LinkMessage,
  { ...hello, auth: { kind: 'pairingToken', token: 'tok' } } as LinkMessage,
  {
    type: 'welcome',
    gatewayVersion: '0.1.0',
    protocolVersion: PROTOCOL_VERSION,
    connectionId: 'c1',
    agentId: 'a1',
    pairingToken: 't',
  },
  {
    type: 'welcome',
    gatewayVersion: '0.1.0',
    protocolVersion: PROTOCOL_VERSION,
    connectionId: 'c1',
    agentId: 'a1',
  },
  { type: 'reject', code: 'PAIRING_INVALID', message: 'no' },
  { type: 'call', id: '1', sessionId: 's', tool: 't', args: { a: 1 } },
  { type: 'result', id: '1', ok: true, text: 'done', structured: { x: [1] } },
  { type: 'error', id: '1', code: 'WORLD_OFFLINE', message: 'off' },
  { type: 'ping' },
  { type: 'pong' },
  { type: 'toolset', tools: ['world_info'] },
];

describe('parseLinkMessage', () => {
  it.each(samples.map((s, i) => [i, s] as const))('round-trips sample %i', (_i, msg) => {
    const r = parseLinkMessage(JSON.stringify(msg));
    expect(r).toEqual({ ok: true, message: msg });
  });

  it('accepts Uint8Array frames', () => {
    const r = parseLinkMessage(new TextEncoder().encode('{"type":"ping"}'));
    expect(r.ok).toBe(true);
  });

  it('rejects unknown type', () => {
    const r = parseLinkMessage('{"type":"bogus"}');
    expect(r).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('rejects extra keys', () => {
    expect(parseLinkMessage('{"type":"ping","x":1}').ok).toBe(false);
    const nested = { ...samples[0], world: { ...world, extra: 1 } };
    expect(parseLinkMessage(JSON.stringify(nested)).ok).toBe(false);
  });

  it('rejects malformed JSON', () => {
    expect(parseLinkMessage('{nope')).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('rejects oversize frames', () => {
    const big = JSON.stringify({
      type: 'result',
      id: '1',
      ok: true,
      text: 'x'.repeat(MAX_FRAME_BYTES),
    });
    expect(parseLinkMessage(big)).toMatchObject({ ok: false, reason: 'oversize' });
  });

  it('rejects result with ok false', () => {
    expect(parseLinkMessage('{"type":"result","id":"1","ok":false,"text":""}').ok).toBe(false);
  });
});

describe('error codes', () => {
  it('includes the required set', () => {
    for (const c of [
      'WORLD_OFFLINE',
      'PROTOCOL_MAJOR_MISMATCH',
      'PAIRING_INVALID',
      'TOOL_NOT_FOUND',
      'FORBIDDEN',
      'INVALID_ARGS',
      'RATE_LIMITED',
      'DENIED',
      'INTERNAL',
    ]) {
      expect(ErrorCode.options).toContain(c);
    }
  });
});

describe('checkCompat', () => {
  it('accepts identical and minor/patch differences', () => {
    expect(checkCompat('1.0.0', '1.0.0')).toEqual({ ok: true });
    expect(checkCompat('1.2.0', '1.5.3')).toEqual({ ok: true });
  });

  it('refuses a major mismatch naming both versions and the side to upgrade', () => {
    const r = checkCompat('1.0.0', '2.0.0');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('PROTOCOL_MAJOR_MISMATCH');
      expect(r.message).toContain('1.0.0');
      expect(r.message).toContain('2.0.0');
      expect(r.message).toMatch(/upgrade the local side/i);
    }
    const r2 = checkCompat('2.0.0', '1.0.0');
    if (!r2.ok) expect(r2.message).toMatch(/upgrade the remote side/i);
  });

  it('refuses unparseable versions', () => {
    expect(checkCompat('1.0.0', 'abc').ok).toBe(false);
  });
});
