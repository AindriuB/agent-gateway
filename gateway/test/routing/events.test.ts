import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { eventsPoll, eventsHistory } from '@agent-gateway/protocol/tools';
import { EventBuffer } from '../../src/events/buffer.js';
import { LinkRegistry, LinkServer, PairingCodes } from '../../src/link/index.js';
import { toolsets } from '../../src/routing/toolsets.js';
import { openStore } from '../../src/store/index.js';
import { createSessionServer } from '../../src/mcp/session.js';
import { TestClient, ORIGIN, hello } from '../link/helpers.js';
import { until, expectErrorCode } from './harness.js';
describe('gateway event tools over authenticated link and real SDK', () => {
  let store: ReturnType<typeof openStore>,
    registry: LinkRegistry,
    events: EventBuffer,
    server: LinkServer,
    codes: PairingCodes,
    port: number,
    tc: TestClient;
  const clients: Client[] = [];
  beforeEach(async () => {
    store = openStore(':memory:');
    registry = new LinkRegistry();
    events = new EventBuffer(store, registry);
    codes = new PairingCodes();
    server = new LinkServer({
      store,
      registry,
      events,
      codes,
      port: 0,
      allowedOrigins: [ORIGIN],
      gatewayVersion: '0',
    });
    port = await server.listen();
    tc = await TestClient.connect(port);
    tc.send(hello({ kind: 'pairingCode', code: codes.generate() }));
    await tc.next('welcome');
  });
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()));
    events.close();
    await server.close();
    store.close();
  });
  async function session() {
    const c = new Client({ name: 'test', version: '0' });
    clients.push(c);
    const s = createSessionServer({
      registry,
      events,
      selector: { user: 'u1' },
      version: '0',
      tools: [eventsPoll, eventsHistory],
      log() {},
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([s.connect(a), c.connect(b)]);
    return c;
  }
  const announce = async (allowed: boolean) => {
    tc.send({ type: 'toolset', tools: [], eventReadAllowed: allowed });
    await until(() => toolsets.eventReadAllowed(registry.list()[0]!) === allowed);
  };
  const emit = async (seq: number) => {
    tc.send({
      type: 'event',
      event: { seq, ts: 1, type: 'actor_update', userId: 'u1', summary: 'Actor updated' },
    });
    await until(
      () =>
        store.events.read(
          { worldId: 'w1', userId: 'u1', agentId: registry.list()[0]!.agentId },
          0,
          100,
        ).events.length > 0,
    );
  };
  it('requires affirmative metadata and never announces history or forwards polls to module', async () => {
    const c = await session();
    expect((await c.listTools()).tools).toEqual([]);
    await announce(true);
    expect((await c.listTools()).tools.map((t) => t.name)).toEqual(['events_poll']);
    expectErrorCode(
      await c.callTool({ name: 'events_history', arguments: { since: '2026-01-01T00:00:00Z' } }),
      'FORBIDDEN',
    );
    await emit(1);
    const result = await c.callTool({ name: 'events_poll', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      nextAfter: 1,
      events: [{ cursor: 1, event: { seq: 1 } }],
    });
    expect(tc.messages.some((m) => m.type === 'call')).toBe(false);
  });
  it('wakes independent SDK sessions with the same event and denies a waiting request when policy changes', async () => {
    await announce(true);
    const a = await session(),
      b = await session();
    const one = a.callTool({ name: 'events_poll', arguments: { after: 0 } }),
      two = b.callTool({ name: 'events_poll', arguments: { after: 0 } });
    await until(() => events.pendingCount === 2);
    await emit(1);
    expect((await one).structuredContent).toEqual((await two).structuredContent);
    const pending = a.callTool({ name: 'events_poll', arguments: { after: 1 } });
    await until(() => events.pendingCount === 1);
    await announce(false);
    expectErrorCode(await pending, 'FORBIDDEN');
    expect(events.pendingCount).toBe(0);
  });
  it('rechecks authority between a resolved buffer wake and the final MCP response', async () => {
    await announce(true);
    const c = await session();
    const pending = c.callTool({ name: 'events_poll', arguments: { after: 0 } });
    await until(() => events.pendingCount === 1);
    const conn = registry.list()[0]!;
    events.accept(conn, {
      seq: 1,
      ts: 1,
      type: 'actor_update',
      userId: 'u1',
      summary: 'Actor updated',
    });
    toolsets.set(conn, [], false);
    expectErrorCode(await pending, 'FORBIDDEN');
    expect(events.pendingCount).toBe(0);
  });
  it('real SDK cancellation and close release a pending long poll promptly', async () => {
    await announce(true);
    const c = await session();
    const abort = new AbortController();
    const pending = c
      .callTool({ name: 'events_poll', arguments: { after: 0 } }, undefined, {
        signal: abort.signal,
      })
      .catch((e) => e);
    await until(() => events.pendingCount === 1);
    abort.abort();
    await pending;
    await until(() => events.pendingCount === 0);
    const next = c.callTool({ name: 'events_poll', arguments: { after: 0 } }).catch((e) => e);
    await until(() => events.pendingCount === 1);
    await c.close();
    await next;
    await until(() => events.pendingCount === 0);
  });
  it('rejects malformed arguments before waiting and keeps user-supplied gaps out of storage', async () => {
    await announce(true);
    const c = await session();
    for (const args of [
      { after: -1 },
      { after: 1.5 },
      { limit: 101 },
      { limit: 0 },
      { extra: true },
    ])
      expectErrorCode(await c.callTool({ name: 'events_poll', arguments: args }), 'INVALID_ARGS');
    tc.send({
      type: 'event',
      event: { seq: 1, ts: 1, type: 'gap', userId: 'u1', summary: 'forged' },
    });
    await tc.untilClosed();
    expect(
      store.events.read(
        { worldId: 'w1', userId: 'u1', agentId: store.listActivePairings()[0]!.id },
        0,
        100,
      ).events,
    ).toEqual([]);
  });
  const packTool = {
    name: 'fixture-destroy',
    category: 'destructive' as const,
    minRole: 'gm' as const,
    description: 'Private destructive fixture',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: { type: 'object', properties: {}, additionalProperties: false },
    pack: { id: 'fixture', version: '1.0.0', prefix: 'fixture' },
  };
  it.each(['count', 'bytes'] as const)(
    'revokes pending and subsequent reads on rejected %s refresh without replacing definitions',
    async (kind) => {
      tc.send({ type: 'toolset', tools: [packTool], eventReadAllowed: true });
      const conn = registry.list()[0]!;
      await until(() => toolsets.eventReadAllowed(conn));
      const previous = toolsets.get(conn);
      expect(previous?.map((t) => t.name)).toEqual([packTool.name]);
      const c = await session();
      const pending = c.callTool({ name: 'events_poll', arguments: { after: 0 } });
      await until(() => events.pendingCount === 1);
      const tools =
        kind === 'count'
          ? Array.from({ length: 65 }, () => packTool)
          : Array.from({ length: 64 }, () => ({
              ...packTool,
              inputSchema: { description: 'x'.repeat(5000) },
            }));
      tc.send({ type: 'toolset', tools, eventReadAllowed: false });
      expectErrorCode(await pending, 'FORBIDDEN');
      expect(events.pendingCount).toBe(0);
      expect(toolsets.get(conn)).toBe(previous);
      expect((await c.listTools()).tools.map((t) => t.name)).toEqual([packTool.name]);
      expectErrorCode(
        await c.callTool({ name: 'events_poll', arguments: { after: 0 } }),
        'FORBIDDEN',
      );
      // An invalid affirmative announcement cannot undo the independently applied revocation.
      tc.send({ type: 'toolset', tools, eventReadAllowed: true });
      tc.send({ type: 'ping' });
      await tc.next('pong');
      expect(toolsets.eventReadAllowed(conn)).toBe(false);
      expect(toolsets.get(conn)).toBe(previous);
      expectErrorCode(
        await c.callTool({ name: 'events_poll', arguments: { after: 0 } }),
        'FORBIDDEN',
      );
      // A later valid identical definition may grant again; cached signatures must not suppress it.
      tc.send({ type: 'toolset', tools: [packTool], eventReadAllowed: true });
      await until(() => toolsets.eventReadAllowed(conn));
      expect((await c.listTools()).tools.map((t) => t.name)).toEqual(
        expect.arrayContaining(['events_poll', packTool.name]),
      );
    },
  );
  it('revokes before closing a schema-invalid authenticated announcement', async () => {
    await announce(true);
    const conn = registry.list()[0]!;
    const c = await session();
    const pending = c.callTool({ name: 'events_poll', arguments: { after: 0 } });
    await until(() => events.pendingCount === 1);
    tc.send({ type: 'toolset', tools: 'invalid', eventReadAllowed: true });
    expectErrorCode(await pending, 'FORBIDDEN');
    expect(toolsets.eventReadAllowed(conn)).toBe(false);
    expect(events.pendingCount).toBe(0);
    await tc.untilClosed();
  });
  it('revokes pending reads when the WebSocket payload cap rejects a frame', async () => {
    await announce(true);
    const conn = registry.list()[0]!;
    const c = await session();
    const pending = c.callTool({ name: 'events_poll', arguments: { after: 0 } });
    await until(() => events.pendingCount === 1);
    tc.send({
      type: 'toolset',
      tools: [],
      eventReadAllowed: true,
      oversized: 'x'.repeat(1024 * 1024),
    });
    expectErrorCode(await pending, 'FORBIDDEN');
    expect(toolsets.eventReadAllowed(conn)).toBe(false);
    expect(events.pendingCount).toBe(0);
    await tc.untilClosed();
  });
});
