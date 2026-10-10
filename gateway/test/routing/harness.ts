import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { defineTool, type ToolDefinition } from '@agent-gateway/protocol/tools';
import { expect } from 'vitest';
import { z } from 'zod';
import { createSessionServer } from '../../src/mcp/session.js';
import type { ToolsetStore, UserSelector } from '../../src/routing/index.js';
import { TestClient, ORIGIN, type Harness } from '../link/helpers.js';

export const fixtureTool = defineTool({
  name: 'fixture_tool',
  minRole: 'player',
  category: 'read',
  handledBy: 'module',
  description: 'fixture',
  input: z.object({ a: z.string() }),
  output: z.object({ b: z.string() }),
});

export const gmFixtureTool = defineTool({
  name: 'fixture_gm_tool',
  minRole: 'gm',
  category: 'read',
  handledBy: 'module',
  description: 'gm fixture',
  input: z.object({}),
  output: z.object({}),
});

export interface FakeModule {
  tc: TestClient;
  userId: string;
  userName: string;
  worldId: string;
  token: string;
  agentId: string;
}

const helloFrame = (
  userId: string,
  userName: string,
  worldId: string,
  isGM: boolean,
  auth: unknown,
) => ({
  type: 'hello',
  protocolVersion: '1.0.0',
  moduleVersion: '0.0.0',
  foundryVersion: '14.0',
  world: { id: worldId, title: 'W', system: 'pf2e', systemVersion: '1' },
  user: { id: userId, name: userName, role: isGM ? 4 : 1, isGM },
  auth,
});

export interface ModuleOpts {
  userName?: string;
  /** Name sent in a reconnect's hello (a claim; the gateway must not trust it). */
  claimName?: string;
  worldId?: string;
  isGM?: boolean;
}

/** A fake module speaking the real link protocol: pairs with a fresh code. */
export async function pairModule(
  h: Harness,
  userId: string,
  opts: ModuleOpts = {},
): Promise<FakeModule> {
  const tc = await TestClient.connect(h.port, ORIGIN);
  const userName = opts.userName ?? userId;
  const worldId = opts.worldId ?? 'w1';
  tc.send(
    helloFrame(userId, userName, worldId, opts.isGM ?? false, {
      kind: 'pairingCode',
      code: h.codes.generate(),
    }),
  );
  const welcome = (await tc.next('welcome')) as { pairingToken?: string; agentId: string };
  return {
    tc,
    userId,
    userName,
    worldId,
    token: welcome.pairingToken ?? '',
    agentId: welcome.agentId,
  };
}

/** Reconnect the same user with its stored token (replaces its live connection). */
export async function reconnectModule(
  h: Harness,
  m: FakeModule,
  opts: ModuleOpts = {},
): Promise<FakeModule> {
  const tc = await TestClient.connect(h.port, ORIGIN);
  tc.send(
    helloFrame(m.userId, opts.claimName ?? m.userName, m.worldId, opts.isGM ?? false, {
      kind: 'pairingToken',
      token: m.token,
    }),
  );
  await tc.next('welcome');
  return { ...m, tc };
}

export interface McpSession {
  client: Client;
  listChanged: { count: number };
  close(): Promise<void>;
}

export async function openSession(
  h: Harness,
  selector: UserSelector = {},
  tools: readonly ToolDefinition[] = [fixtureTool, gmFixtureTool],
  callTimeoutMs = 5000,
  extra: {
    log?: (line: string) => void;
    listChangedIntervalMs?: number;
    toolsets?: ToolsetStore;
  } = {},
): Promise<McpSession> {
  const server = createSessionServer({
    version: '0.0.0',
    registry: h.registry,
    selector,
    tools,
    callTimeoutMs,
    knownIdentities: () =>
      h.store
        .listActivePairings()
        .map((p) => ({ worldId: p.worldId, userId: p.userId, userName: p.userName })),
    ...extra,
  });
  const client = new Client({ name: 't', version: '0' });
  const listChanged = { count: 0 };
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    listChanged.count++;
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, listChanged, close: () => client.close() };
}

export const tick = (ms = 50): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await tick(5);
  }
}

/** An error result: isError, `<CODE>: ...` in the text, and no structuredContent. */
export function expectErrorCode(res: Record<string, unknown>, code: string): void {
  expect(res.isError).toBe(true);
  expect(res.structuredContent).toBeUndefined();
  const content = res.content as { type: string; text: string }[];
  expect(content[0]?.text.startsWith(`${code}: `)).toBe(true);
}
