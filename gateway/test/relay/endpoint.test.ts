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
  TopLevelIdScanner,
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
  it('uses <stateDir>/relay-<port>.sock on darwin', () => {
    expect(relayEndpoint('/Users/a/.foundry-agent-gateway', 7420, 'darwin')).toEqual({
      ok: true,
      path: '/Users/a/.foundry-agent-gateway/relay-7420.sock',
    });
  });

  it('refuses a darwin path over 103 bytes and names the length', () => {
    const dir = `/${'d'.repeat(100)}`;
    const r = relayEndpoint(dir, 7420, 'darwin');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(`${Buffer.byteLength(`${dir}/relay-7420.sock`)} bytes`);
    expect(relayEndpoint(`/${'d'.repeat(80)}`, 7420, 'darwin').ok).toBe(true);
  });

  it('derives a named pipe from the lowercased state dir on win32 (pure function)', () => {
    const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
    const a = relayEndpoint('C:\\Users\\Andrew\\.foundry-agent-gateway', 7420, 'win32');
    expect(a).toEqual({
      ok: true,
      path: `\\\\.\\pipe\\foundry-agent-gateway-${hash('c:\\users\\andrew\\.foundry-agent-gateway|7420')}`,
    });
    expect(relayEndpoint('c:\\USERS\\andrew\\.foundry-agent-gateway', 7420, 'win32')).toEqual(a);
    expect(relayEndpoint('C:\\Other', 7420, 'win32')).not.toEqual(a);
    expect(relayEndpoint('C:\\Users\\Andrew\\.foundry-agent-gateway', 7421, 'win32')).not.toEqual(
      a,
    );
    const unix = relayEndpoint('/tmp/x', 7421, 'darwin');
    expect(unix).toEqual({ ok: true, path: '/tmp/x/relay-7421.sock' });
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

describe('secret file', () => {
  it('carries the per-boot pipe name on win32 and ignores foreign pipe names', async () => {
    const { parseSecretFile, PIPE_PREFIX } = await import('../../src/relay/index.js');
    expect(parseSecretFile('abc')).toEqual({ secret: 'abc' });
    expect(parseSecretFile(`abc\n${PIPE_PREFIX}1234-ffff\n`)).toEqual({
      secret: 'abc',
      pipe: `${PIPE_PREFIX}1234-ffff`,
    });
    expect(parseSecretFile('abc\n\\\\.\\pipe\\evil\n')).toEqual({ secret: 'abc' });
  });
});

describe('TopLevelIdScanner', () => {
  const idOf = (json: string) => {
    const s = new TopLevelIdScanner();
    // fed in awkward pieces to prove it is streaming
    const b = Buffer.from(json);
    for (let i = 0; i < b.length; i += 7) s.feed(b.subarray(i, i + 7));
    return s.result();
  };
  it('finds a top-level id wherever it sits', () => {
    expect(idOf('{"id":12,"method":"x"}')).toBe(12);
    expect(idOf('{"method":"x","params":{},"id":"abc"}')).toBe('abc');
    expect(idOf('{ "jsonrpc": "2.0", "id" : -4 , "method": "x" }')).toBe(-4);
    expect(idOf('{"id":7}')).toBe(7);
  });
  it('ignores nested ids, ids in arrays and ids inside strings', () => {
    expect(idOf('{"params":{"id":99},"id":1}')).toBe(1);
    expect(idOf('{"params":[{"id":99}],"method":"x"}')).toBeUndefined();
    expect(idOf('{"s":"x\\" , \\"id\\":5","id":2}')).toBe(2);
    expect(idOf('{"s":"\\\\","id":3}')).toBe(3);
    expect(idOf('{"method":"x","params":{"id":1}}')).toBeUndefined();
  });
  it('bounds string ids and rejects non-scalar ids', () => {
    expect(idOf(`{"id":"${'a'.repeat(300)}"}`)).toBeUndefined();
    expect(idOf('{"id":{"a":1}}')).toBeUndefined();
    expect(idOf('{"id":null}')).toBeUndefined();
  });
});
