import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpServer } from '../../src/http/index.js';
import { EventBuffer } from '../../src/events/index.js';
import { createSessionServer } from '../../src/mcp/session.js';
import { ToolsetStore } from '../../src/routing/toolsets.js';
import {
  HTTP_SESSION_IDLE_MS,
  MAX_HTTP_SESSIONS,
  MAX_HTTP_SESSIONS_PUBLIC,
  PUBLIC_HTTP_SESSION_IDLE_MS,
} from '../../src/config/index.js';
import { startServer, type Harness } from '../link/helpers.js';
import { fixtureTool } from '../routing/harness.js';

let h: Harness | undefined;
let http: HttpServer | undefined;
let events: EventBuffer | undefined;
afterEach(async () => {
  await http?.close();
  http = undefined;
  events?.close();
  events = undefined;
  await h?.server.close();
  h?.store.close();
  h = undefined;
});

async function setup(maxSessions = MAX_HTTP_SESSIONS_PUBLIC) {
  h = await startServer();
  const harness = h;
  const toolsets = new ToolsetStore(() => undefined);
  const buf = new EventBuffer(harness.store, harness.registry, toolsets);
  events = buf;
  const clock = { t: 1_000_000 };
  http = new HttpServer({
    host: '127.0.0.1',
    port: 0,
    registry: harness.registry,
    version: '9.9.9',
    startedAt: Date.now(),
    publicUrl: 'https://gw.example.com',
    trustProxy: true,
    authenticate: (req) => {
      const p = req.headers['x-principal'];
      return typeof p === 'string'
        ? { key: `oauth:${p}`, selector: { worldId: 'w1', userId: 'u1' } }
        : undefined;
    },
    createSession: () =>
      createSessionServer({
        version: '0.0.0',
        registry: harness.registry,
        selector: { world: 'w1', user: 'u1', exactId: true },
        tools: [fixtureTool],
        toolsets,
        events: buf,
        callTimeoutMs: 5000,
      }),
    maxRequestBytes: 10_000,
    rps: 1000,
    maxSessions,
    idleMs: 1000,
    now: () => (clock.t += 100),
  });
  const port = await http.listen();
  return { port, toolsets, buf, registry: harness.registry, clock };
}

const send = (
  port: number,
  headers: Record<string, string>,
  body?: string,
  method = 'POST',
): Promise<{ status: number; sid: string | undefined }> =>
  new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method,
        headers: {
          host: 'gw.example.com',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...headers,
        },
      },
      (res) => {
        res.resume();
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, sid: res.headers['mcp-session-id'] as string }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
const initBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 't', version: '0' },
  },
});
const open = async (port: number, principal: string, ip: string) => {
  const r = await send(port, { 'x-principal': principal, 'x-forwarded-for': ip }, initBody);
  expect(r.status).toBe(200);
  return r.sid!;
};

describe('session listeners on the shared emitters', () => {
  it('returns every count to baseline after evict, DELETE and sweep cycles', async () => {
    const { port, toolsets, buf, registry, clock } = await setup();
    const counts = () => ({
      registry: [registry.listenerCount('connected'), registry.listenerCount('disconnected')],
      toolsets: toolsets.listenerCount('changed'),
      events: buf.listenerCount('changed'),
    });
    const base = counts();

    // open -> evict: one principal, so every open past the cap evicts one.
    for (let i = 0; i < 50; i++) await open(port, 'evictor', '7.7.7.7');
    expect(http!.sessionCount).toBeLessThanOrEqual(4);
    // Drain what is left of the eviction phase.
    clock.t += 10_000;
    http!.sweep();
    await new Promise((r) => setTimeout(r, 50));
    expect(http!.sessionCount).toBe(0);
    expect(counts()).toEqual(base);

    // open -> DELETE
    for (let i = 0; i < 50; i++) {
      const sid = await open(port, 'deleter', '7.7.7.8');
      const d = await send(
        port,
        { 'x-principal': 'deleter', 'x-forwarded-for': '7.7.7.8', 'mcp-session-id': sid },
        undefined,
        'DELETE',
      );
      expect(d.status).toBe(200);
    }
    expect(http!.sessionCount).toBe(0);
    expect(counts()).toEqual(base);

    // open -> idle sweep
    for (let i = 0; i < 50; i++) {
      await open(port, 'sweeper', '7.7.7.9');
      clock.t += 10_000;
      http!.sweep();
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(http!.sessionCount).toBe(0);
    expect(counts()).toEqual(base);
  });

  it('emits no MaxListenersExceededWarning with MAX_HTTP_SESSIONS_PUBLIC sessions open', async () => {
    const { port, toolsets, buf, registry } = await setup();
    const warnings: string[] = [];
    const onWarning = (w: Error) => warnings.push(w.name);
    process.on('warning', onWarning);
    try {
      for (let i = 0; i < MAX_HTTP_SESSIONS_PUBLIC; i++)
        await open(port, `p${i}`, `10.1.${Math.floor(i / 8)}.${i % 8}`);
      expect(http!.sessionCount).toBe(MAX_HTTP_SESSIONS_PUBLIC);
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      process.off('warning', onWarning);
    }
    expect(warnings).not.toContain('MaxListenersExceededWarning');
    expect(registry.listenerCount('connected')).toBeLessThan(10);
    expect(toolsets.listenerCount('changed')).toBeLessThan(10);
    expect(buf.listenerCount('changed')).toBeLessThan(10);
  });

  it('keeps the public and local session constants apart', () => {
    expect(MAX_HTTP_SESSIONS_PUBLIC).toBe(64);
    expect(PUBLIC_HTTP_SESSION_IDLE_MS).toBe(10 * 60_000);
    expect(MAX_HTTP_SESSIONS).toBe(16);
    expect(HTTP_SESSION_IDLE_MS).toBe(30 * 60_000);
  });
});
