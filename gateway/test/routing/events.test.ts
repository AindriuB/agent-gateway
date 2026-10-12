import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { eventsPoll, eventsHistory, worldInfo } from '@agent-gateway/protocol/tools';
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
  let pairedToken: string;
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
    const welcome = await tc.next('welcome');
    if (welcome.type !== 'welcome' || !welcome.pairingToken) throw Error('Missing paired token');
    pairedToken = welcome.pairingToken;
  });
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()));
    events.close();
    await server.close();
    store.close();
  });
  async function session(selector: { user?: string } = { user: 'u1' }, includeModule = false) {
    const c = new Client({ name: 'test', version: '0' });
    clients.push(c);
    const s = createSessionServer({
      registry,
      events,
      selector,
      knownIdentities: () =>
        store
          .listActivePairings()
          .map((p) => ({ worldId: p.worldId, userId: p.userId, userName: p.userName })),
      version: '0',
      tools: includeModule ? [eventsPoll, eventsHistory, worldInfo] : [eventsPoll, eventsHistory],
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
  it('reads history and immediate offline polls by exact persisted identity only', async () => {
    await announce(true);
    await emit(1);
    const conn = registry.list()[0]!;
    tc.send({ type: 'eventPolicy', enabled: true, retentionDays: 14 });
    await until(() => store.events.policy('w1').enabled);
    const bound = await session();
    expect((await bound.listTools()).tools.map((t) => t.name)).toEqual([
      'events_poll',
      'events_history',
    ]);
    tc.ws.close();
    await tc.untilClosed();
    await until(() => registry.list().length === 0);
    const exact = await session();
    const result = await exact.callTool({ name: 'events_poll', arguments: { after: 0 } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ events: [{ cursor: 1 }], nextAfter: 1 });
    expect(
      (
        await exact.callTool({
          name: 'events_history',
          arguments: { since: '1970-01-01T00:00:00Z' },
        })
      ).structuredContent,
    ).toMatchObject({ events: [{ cursor: 1 }] });
    expect(events.pendingCount).toBe(0);
    const named = await session({ user: conn.info.userName || 'not-native-id' });
    expectErrorCode(await named.callTool({ name: 'events_poll', arguments: {} }), 'WORLD_OFFLINE');
    store.events.setPolicy('w1', { enabled: false, retentionDays: 14 });
    expectErrorCode(await exact.callTool({ name: 'events_poll', arguments: {} }), 'WORLD_OFFLINE');
    expect((await exact.listTools()).tools).toEqual([]);
  });
  it('purges only authenticated world rows and replies to the exact request with a count', async () => {
    await announce(true);
    await emit(1);
    const conn = registry.list()[0]!;
    tc.send({ type: 'eventPolicy', enabled: true, retentionDays: 14 });
    await until(() => store.events.policy('w1').enabled);
    store.events.append(
      { worldId: 'other', userId: 'u1', agentId: 'other' },
      { seq: 1, ts: 1, type: 'actor_update', userId: 'u1', summary: 'Other' },
      1,
    );
    tc.send({ type: 'purgeEvents', requestId: 'owned-purge' });
    expect(await tc.next('purgeEventsResult')).toMatchObject({
      requestId: 'owned-purge',
      count: 1,
    });
    expect(
      store.events.read({ worldId: 'w1', userId: 'u1', agentId: conn.agentId }, 0, 100),
    ).toMatchObject({ events: [], nextAfter: 1, cursorGap: { after: 0 } });
    expect(
      store.events.read({ worldId: 'other', userId: 'u1', agentId: 'other' }, 0, 100).events,
    ).toHaveLength(1);
    tc.send({ type: 'purgeEvents', requestId: 'empty-purge' });
    expect(await tc.next('purgeEventsResult')).toMatchObject({
      requestId: 'empty-purge',
      count: 0,
    });
  });
  it('persists restrictive cap revocation for offline reads', async () => {
    await announce(true);
    tc.send({ type: 'eventPolicy', enabled: true, retentionDays: 14 });
    await until(() => store.events.policy('w1').enabled);
    const c = await session();
    await c.listTools();
    tc.send({ type: 'toolset', tools: Array(65).fill(eventsPoll), eventReadAllowed: false });
    await until(() => !toolsets.eventReadAllowed(registry.list()[0]!));
    tc.ws.close();
    await tc.untilClosed();
    await until(() => registry.list().length === 0);
    expectErrorCode(await c.callTool({ name: 'events_poll', arguments: {} }), 'FORBIDDEN');
  });
  it('contains permission persistence failures and denies the old offline grant', async () => {
    await announce(true);
    await emit(1);
    tc.send({ type: 'eventPolicy', enabled: true, retentionDays: 14 });
    await until(() => store.events.policy('w1').enabled);
    const c = await session();
    await c.listTools();
    const spy = vi.spyOn(store.events, 'setReadAllowed').mockImplementation(() => {
      throw Error('injected SQL failure');
    });
    try {
      tc.send({ type: 'toolset', tools: [], eventReadAllowed: false });
      await tc.untilClosed();
      await until(() => registry.list().length === 0);
      expectErrorCode(await c.callTool({ name: 'events_poll', arguments: {} }), 'FORBIDDEN');
    } finally {
      spy.mockRestore();
    }
  });
  it('pins the event agent and refuses to follow a replacement pairing', async () => {
    await announce(true);
    await emit(1);
    const old = registry.list()[0]!;
    tc.send({ type: 'eventPolicy', enabled: true, retentionDays: 14 });
    await until(() => store.events.policy('w1').enabled);
    const c = await session();
    await c.listTools();
    tc.ws.close();
    await tc.untilClosed();
    await until(() => registry.list().length === 0);
    store.revokePairing(old.agentId);
    store.createPairing({
      id: 'replacement',
      tokenHash: 'replacement',
      worldId: 'w1',
      userId: 'u1',
    });
    store.events.setReadAllowed({ worldId: 'w1', userId: 'u1', agentId: 'replacement' }, true);
    expectErrorCode(await c.callTool({ name: 'events_poll', arguments: {} }), 'FORBIDDEN');
  });
  it('a new connection without an announcement cannot revive persisted offline permission', async () => {
    await announce(true);
    await emit(1);
    tc.send({ type: 'eventPolicy', enabled: true, retentionDays: 14 });
    await until(() => store.events.policy('w1').enabled);
    const c = await session();
    await c.listTools();
    tc.ws.close();
    await tc.untilClosed();
    await until(() => registry.list().length === 0);
    tc = await TestClient.connect(port);
    tc.send(hello({ kind: 'pairingToken', token: pairedToken }));
    await tc.next('welcome');
    tc.ws.close();
    await tc.untilClosed();
    await until(() => registry.list().length === 0);
    expectErrorCode(await c.callTool({ name: 'events_poll', arguments: {} }), 'FORBIDDEN');
  });
  it('blocks all owners in a world when a restrictive policy update cannot persist', async () => {
    await announce(true);
    await emit(1);
    tc.send({ type: 'eventPolicy', enabled: true, retentionDays: 14 });
    await until(() => store.events.policy('w1').enabled);
    const c = await session();
    await c.listTools();
    store.createPairing({
      id: 'other-owner',
      tokenHash: 'other-owner',
      worldId: 'w1',
      userId: 'other',
    });
    store.events.setReadAllowed({ worldId: 'w1', userId: 'other', agentId: 'other-owner' }, true);
    const spy = vi.spyOn(store.events, 'setPolicy').mockImplementation(() => {
      throw Error('injected policy write failure');
    });
    try {
      tc.send({ type: 'eventPolicy', enabled: false, retentionDays: 14 });
      await tc.untilClosed();
      await until(() => registry.list().length === 0);
      expectErrorCode(await c.callTool({ name: 'events_poll', arguments: {} }), 'FORBIDDEN');
      const other = await session({ user: 'other' });
      expectErrorCode(
        await other.callTool({
          name: 'events_history',
          arguments: { since: '1970-01-01T00:00:00Z' },
        }),
        'FORBIDDEN',
      );
    } finally {
      spy.mockRestore();
    }
  });
  it('cannot convert an implicit offline module binding into offline event authority', async () => {
    await announce(true);
    await emit(1);
    tc.send({ type: 'eventPolicy', enabled: true, retentionDays: 14 });
    await until(() => store.events.policy('w1').enabled);
    tc.ws.close();
    await tc.untilClosed();
    await until(() => registry.list().length === 0);
    const implicit = await session({}, true);
    expectErrorCode(
      await implicit.callTool({ name: 'world_info', arguments: {} }),
      'WORLD_OFFLINE',
    );
    expectErrorCode(
      await implicit.callTool({ name: 'events_poll', arguments: {} }),
      'WORLD_OFFLINE',
    );
    expect((await implicit.listTools()).tools.some((t) => t.name === 'events_poll')).toBe(false);
  });
});
