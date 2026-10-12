import { expect, it } from 'vitest';
import { AgentEvent, EventType, EVENT_CONFIG, parseLinkMessage } from '../../src/index.js';
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
