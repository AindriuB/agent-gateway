import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, type LinkMessage } from '@agent-gateway/protocol';
import {
  LinkRegistry,
  LinkServer,
  PairingCodes,
  type LinkServerOptions,
} from '../../src/link/index.js';
import { openStore, type Store } from '../../src/store/index.js';

export const ORIGIN = 'http://localhost:30000';

export interface Harness {
  server: LinkServer;
  port: number;
  store: Store;
  codes: PairingCodes;
  registry: LinkRegistry;
  dbPath: string;
}

export async function startServer(over: Partial<LinkServerOptions> = {}): Promise<Harness> {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'ag-link-')), 'g.db');
  const store = openStore(dbPath);
  const codes = new PairingCodes();
  const registry = new LinkRegistry();
  const server = new LinkServer({
    port: 0,
    store,
    codes,
    registry,
    allowedOrigins: [ORIGIN],
    gatewayVersion: '0.0.0-test',
    ...over,
  });
  const port = await server.listen();
  return { server, port, store, codes, registry, dbPath };
}

export class TestClient {
  readonly messages: LinkMessage[] = [];
  private waiters: (() => void)[] = [];
  closed = false;

  constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      this.messages.push(JSON.parse(d.toString()) as LinkMessage);
      this.waiters.splice(0).forEach((w) => w());
    });
    ws.on('close', () => {
      this.closed = true;
      this.waiters.splice(0).forEach((w) => w());
    });
  }

  static async connect(
    port: number,
    origin: string | null = ORIGIN,
    extra: { host?: string } = {},
  ): Promise<TestClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      ...(origin ? { origin } : {}),
      ...(extra.host ? { headers: { Host: extra.host } } : {}),
    });
    await new Promise<void>((res, rej) => {
      ws.once('open', () => res());
      ws.once('error', rej);
    });
    return new TestClient(ws);
  }

  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }

  async next(type?: string): Promise<LinkMessage> {
    for (;;) {
      const i = this.messages.findIndex((m) => !type || m.type === type);
      if (i >= 0) return this.messages.splice(i, 1)[0] as LinkMessage;
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }

  async untilClosed(): Promise<void> {
    while (!this.closed) await new Promise<void>((r) => this.waiters.push(r));
  }
}

export const hello = (
  auth: { kind: 'pairingCode'; code: string } | { kind: 'pairingToken'; token: string },
  over: { protocolVersion?: string; worldId?: string; userId?: string } = {},
) => ({
  type: 'hello',
  protocolVersion: over.protocolVersion ?? PROTOCOL_VERSION,
  moduleVersion: '0.0.0',
  foundryVersion: '13.0',
  world: { id: over.worldId ?? 'w1', title: 'W', system: 'dnd5e', systemVersion: '5' },
  user: { id: over.userId ?? 'u1', name: 'U', role: 4, isGM: true },
  auth,
});
