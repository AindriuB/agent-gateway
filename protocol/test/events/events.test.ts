import { expect, it } from 'vitest';
import {
  BufferedEvent,
  GatewayGap,
  eventsPoll,
  eventsHistory,
  AgentEvent,
  EventType,
  EVENT_CONFIG,
  parseLinkMessage,
} from '../../src/index.js';
const sample = {
  seq: 1,
  ts: 0,
  type: 'actor_update',
  userId: 'observer',
  summary: 'Actor updated',
  doc: { uuid: 'Actor.a', type: 'Actor', name: 'Visible name' },
};
it('defines all event families, a bounded shared coalesce configuration and the event frame', () => {
  expect(EVENT_CONFIG.COALESCE_MS).toBe(500);
  expect(EVENT_CONFIG.MAX_PENDING_UPDATES).toBeGreaterThan(0);
  for (const type of EventType.options)
    expect(AgentEvent.safeParse({ ...sample, type }).success).toBe(true);
  expect(parseLinkMessage(JSON.stringify({ type: 'event', event: sample }))).toEqual({
    ok: true,
    message: { type: 'event', event: sample },
  });
});
it.each([
  { summary: 'x'.repeat(201) },
  { seq: 0 },
  { seq: 1.5 },
  { seq: Number.MAX_SAFE_INTEGER + 1 },
  { ts: Infinity },
  { ts: -1 },
  { userId: 'x'.repeat(101) },
  { type: 'arbitrary' },
  { data: { secret: true } },
  { doc: { ...sample.doc, system: { secret: true } } },
  { doc: { ...sample.doc, uuid: 'x'.repeat(2049) } },
])('refuses unbounded or full-payload events %j', (patch) =>
  expect(AgentEvent.safeParse({ ...sample, ...patch }).success).toBe(false),
);
it('accepts only the explicit boolean agent flag and rejects unknown frame fields', () => {
  expect(AgentEvent.parse({ ...sample, agent_action: true }).agent_action).toBe(true);
  expect(AgentEvent.safeParse({ ...sample, agent_action: 'call-secret' }).success).toBe(false);
  expect(
    parseLinkMessage(JSON.stringify({ type: 'event', event: sample, document: { secret: true } }))
      .ok,
  ).toBe(false);
});

it('separates the durable cursor and gateway gap from native sequence', () => {
  expect(BufferedEvent.parse({ cursor: 7, event: sample }).cursor).toBe(7);
  const gap = {
    type: 'gap',
    ts: 2,
    userId: 'observer',
    summary: 'Connection interrupted',
    missed: 'unknown',
  };
  expect(GatewayGap.safeParse(gap).success).toBe(true);
  expect(GatewayGap.safeParse({ ...gap, seq: 7 }).success).toBe(false);
  expect(BufferedEvent.safeParse({ cursor: 0, event: sample }).success).toBe(false);
  expect(BufferedEvent.safeParse({ cursor: 1, event: { ...gap, missed: -1 } }).success).toBe(false);
  expect(eventsPoll.input.parse({})).toEqual({ limit: 100 });
  for (const since of ['yesterday', '2026-02-30T00:00:00Z', '2026-01-01'])
    expect(eventsHistory.input.safeParse({ since }).success).toBe(false);
  expect(
    eventsHistory.input.safeParse({ since: '2026-01-01T00:00:00Z', types: ['actor_update'] })
      .success,
  ).toBe(true);
});
