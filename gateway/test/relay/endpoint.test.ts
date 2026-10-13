import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MAX_RELAY_BUFFERED_BYTES,
  MAX_RELAY_LINE_BYTES,
  MAX_RELAY_PENDING,
  MAX_RELAY_SESSIONS,
  RELAY_CONNECT_ATTEMPTS,
  RELAY_HANDSHAKE_MS,
  RELAY_RPC_ERROR,
  RELAY_BUSY,
  RELAY_LOST,
  RELAY_RECONNECTING,
  relayEndpoint,
  LineSplitter,
  LineTooLongError,
} from '../../src/relay/index.js';

describe('relay constants', () => {
  it('have the designed values', () => {
    expect(MAX_RELAY_LINE_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_RELAY_SESSIONS).toBe(16);
    expect(MAX_RELAY_BUFFERED_BYTES).toBe(8 * 1024 * 1024);
    expect(MAX_RELAY_PENDING).toBe(256);
    expect(RELAY_CONNECT_ATTEMPTS).toBe(10);
    expect(RELAY_HANDSHAKE_MS).toBe(2000);
    expect(RELAY_RPC_ERROR).toBe(-32001);
    expect([RELAY_LOST, RELAY_BUSY, RELAY_RECONNECTING]).toEqual([
      'RELAY_LOST',
      'RELAY_BUSY',
      'RELAY_RECONNECTING',
    ]);
  });
});

describe('relayEndpoint', () => {
  it('uses <stateDir>/relay.sock on darwin', () => {
    expect(relayEndpoint('/Users/a/.foundry-agent-gateway', 'darwin')).toEqual({
      ok: true,
      path: '/Users/a/.foundry-agent-gateway/relay.sock',
    });
  });

  it('refuses a darwin path over 103 bytes and names the length', () => {
    const dir = `/${'d'.repeat(100)}`;
    const r = relayEndpoint(dir, 'darwin');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(`${Buffer.byteLength(`${dir}/relay.sock`)} bytes`);
    expect(relayEndpoint(`/${'d'.repeat(80)}`, 'darwin').ok).toBe(true);
  });

  it('derives a named pipe from the lowercased state dir on win32 (pure function)', () => {
    const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
    const a = relayEndpoint('C:\\Users\\Andrew\\.foundry-agent-gateway', 'win32');
    expect(a).toEqual({
      ok: true,
      path: `\\\\.\\pipe\\foundry-agent-gateway-${hash('c:\\users\\andrew\\.foundry-agent-gateway')}`,
    });
    expect(relayEndpoint('c:\\USERS\\andrew\\.foundry-agent-gateway', 'win32')).toEqual(a);
    expect(relayEndpoint('C:\\Other', 'win32')).not.toEqual(a);
  });
});

describe('LineSplitter', () => {
  it('splits across chunks and keeps multibyte characters whole', () => {
    const s = new LineSplitter(100);
    const bytes = Buffer.from('{"a":"é"}\n{"b":1}\n');
    expect(s.push(bytes.subarray(0, 7))).toEqual([]);
    expect(s.push(bytes.subarray(7))).toEqual(['{"a":"é"}', '{"b":1}']);
  });

  it('throws on an oversized line, drops it, and carries on', () => {
    const s = new LineSplitter(10);
    expect(() => s.push(Buffer.from('x'.repeat(8)))).not.toThrow();
    expect(() => s.push(Buffer.from('x'.repeat(8)))).toThrow(LineTooLongError);
    expect(s.push(Buffer.from('zzz\nok\n'))).toEqual(['ok']);
    expect(() => s.push(Buffer.from(`${'y'.repeat(11)}\nok\n`))).toThrow(LineTooLongError);
    expect(s.push(Buffer.from('fine\n'))).toEqual(['fine']);
  });
});
