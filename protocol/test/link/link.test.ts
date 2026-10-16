import { TOOLS, toJsonSchema } from '../../src/tools/index.js';
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
  {
    type: 'toolset',
    tools: [
      {
        name: TOOLS[0]!.name,
        description: TOOLS[0]!.description,
        category: TOOLS[0]!.category,
        minRole: TOOLS[0]!.minRole,
        ...toJsonSchema(TOOLS[0]!),
      },
    ],
  },
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

describe('consentCode forAgent (task 98)', () => {
  const base = {
    type: 'consentCode',
    code: '12345678',
    clientName: 'C',
    scopes: ['read'],
    expiresAt: 1,
  };
  it('parses with and without the agent field, and rejects unknown extras', () => {
    expect(parseLinkMessage(JSON.stringify(base)).ok).toBe(true);
    const withAgent = { ...base, forAgent: { userId: 'a1', name: 'Bot' } };
    expect(parseLinkMessage(JSON.stringify(withAgent))).toEqual({ ok: true, message: withAgent });
    expect(parseLinkMessage(JSON.stringify({ ...base, extra: 1 })).ok).toBe(false);
    expect(
      parseLinkMessage(JSON.stringify({ ...base, forAgent: { userId: 'a1', name: 'B', x: 1 } })).ok,
    ).toBe(false);
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
      'PAIRING_UNCONFIRMED',
    ]) {
      expect(ErrorCode.options).toContain(c);
    }
  });
});

describe('checkCompat', () => {
  it('accepts identical and minor/patch differences', () => {
    expect(PROTOCOL_VERSION).toBe('7.1.0');
    expect(checkCompat(PROTOCOL_VERSION, '7.0.0')).toEqual({ ok: true });
    expect(checkCompat(PROTOCOL_VERSION, '7.5.3')).toEqual({ ok: true });
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

  it.each([
    '1.0.0',
    '1.99.7',
    '2.0.0',
    '2.99.7',
    '3.0.0',
    '3.99.7',
    '4.0.0',
    '4.99.7',
    '5.0.0',
    '5.99.7',
  ])('refuses older protocol %s in either direction', (legacy) => {
    expect(checkCompat(PROTOCOL_VERSION, legacy)).toMatchObject({
      ok: false,
      code: 'PROTOCOL_MAJOR_MISMATCH',
    });
    expect(checkCompat(legacy, PROTOCOL_VERSION)).toMatchObject({
      ok: false,
      code: 'PROTOCOL_MAJOR_MISMATCH',
    });
  });

  it('refuses unparseable versions', () => {
    expect(checkCompat('1.0.0', 'abc').ok).toBe(false);
  });
});

// Announcement caps are separate from the general link frame ceiling.
describe('full toolset limits', () => {
  const tool = {
    name: TOOLS[0]!.name,
    description: TOOLS[0]!.description,
    category: TOOLS[0]!.category,
    minRole: TOOLS[0]!.minRole,
    ...toJsonSchema(TOOLS[0]!),
  };
  it('rejects count and UTF-8 byte overflows', () => {
    expect(
      parseLinkMessage(
        JSON.stringify({ type: 'toolset', tools: Array.from({ length: 65 }, () => tool) }),
      ).ok,
    ).toBe(false);
    expect(
      parseLinkMessage(
        JSON.stringify({
          type: 'toolset',
          tools: [{ ...tool, description: 'é'.repeat(140 * 1024) }],
        }),
      ).ok,
    ).toBe(false);
  });
  it('rejects obsolete name-only announcements', () => {
    expect(parseLinkMessage(JSON.stringify({ type: 'toolset', tools: ['world_info'] })).ok).toBe(
      false,
    );
  });
});

it('strictly bounds offline policy and derives purge identity from the connection', () => {
  for (const frame of [
    { type: 'eventPolicy', enabled: true, retentionDays: 1 },
    { type: 'eventPolicy', enabled: false, retentionDays: 365 },
    { type: 'purgeEvents', requestId: 'request' },
    { type: 'purgeEventsResult', requestId: 'request', count: 0 },
  ])
    expect(parseLinkMessage(JSON.stringify(frame)).ok).toBe(true);
  for (const frame of [
    { type: 'eventPolicy', enabled: true, retentionDays: 0 },
    { type: 'eventPolicy', enabled: true, retentionDays: 366 },
    { type: 'eventPolicy', enabled: 'true', retentionDays: 14 },
    { type: 'purgeEvents', requestId: 'r', worldId: 'foreign' },
    { type: 'purgeEvents', requestId: 'x'.repeat(101) },
    { type: 'purgeEventsResult', requestId: 'r', count: -1 },
  ])
    expect(parseLinkMessage(JSON.stringify(frame)).ok).toBe(false);
});

describe('protocol6 queued replay boundaries', () => {
  const tool = TOOLS.find((t) => t.name === 'chat_post')!;
  const definition = {
    name: tool.name,
    description: tool.description,
    category: tool.category,
    minRole: tool.minRole,
    ...toJsonSchema(tool),
  };
  const call = {
    id: 'r'.repeat(32),
    sessionId: 'session',
    tool: tool.name,
    args: { content: 'fixture' },
    expiresAt: 1000,
    definition,
  };
  it('parses bounded replay and correlated status, preserving ordinary calls', () => {
    for (const frame of [
      { type: 'queuedCalls', calls: [call] },
      { type: 'queuedStatus', id: call.id, status: 'pending', text: 'waiting' },
    ])
      expect(parseLinkMessage(JSON.stringify(frame)).ok).toBe(true);
    expect(PROTOCOL_VERSION).toBe('7.1.0');
    expect(checkCompat(PROTOCOL_VERSION, '6.0.0').ok).toBe(false);
  });
  it.each([
    { ...call, id: 'wrong' },
    { ...call, approved: true },
    { ...call, userId: 'forged' },
    { ...call, expiresAt: 0 },
  ])('rejects forged or invalid replay fields', (bad) => {
    expect(parseLinkMessage(JSON.stringify({ type: 'queuedCalls', calls: [bad] })).ok).toBe(false);
  });
  it('rejects oversized batches and structured replay results', () => {
    expect(
      parseLinkMessage(JSON.stringify({ type: 'queuedCalls', calls: Array(6).fill(call) })).ok,
    ).toBe(false);
    expect(
      parseLinkMessage(
        JSON.stringify({
          type: 'queuedStatus',
          id: call.id,
          status: 'approved',
          text: 'ok',
          structured: { secret: true },
        }),
      ).ok,
    ).toBe(false);
  });
  it('preserves only literal approved execution failure flags', () => {
    for (const resultFailed of [true, false])
      expect(
        parseLinkMessage(
          JSON.stringify({
            type: 'queuedStatus',
            id: call.id,
            status: 'approved',
            text: 'result',
            resultFailed,
          }),
        ),
      ).toMatchObject({ ok: true, message: { resultFailed } });
    for (const resultFailed of ['true', 1, [], null])
      expect(
        parseLinkMessage(
          JSON.stringify({
            type: 'queuedStatus',
            id: call.id,
            status: 'approved',
            text: 'result',
            resultFailed,
          }),
        ).ok,
      ).toBe(false);
    expect(
      parseLinkMessage(
        JSON.stringify({
          type: 'queuedStatus',
          id: call.id,
          status: 'pending',
          text: 'waiting',
          resultFailed: true,
        }),
      ).ok,
    ).toBe(false);
  });
});
