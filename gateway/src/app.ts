import { OfflineQueue } from './offline-queue/service.js';
import { EventBuffer } from './events/index.js';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Config } from './config/index.js';
import { LinkListenError, mapListenError } from './link/server.js';
import { LinkRegistry, LinkServer, PairingCodes, PAIRING_CODE_TTL_MS } from './link/index.js';
import { createLogger, type Logger } from './log.js';
import { createDegradedServer } from './mcp/degraded.js';
import { createSessionServer } from './mcp/session.js';
import type { UserSelector } from './routing/index.js';
import { openStore, type Store } from './store/index.js';

export const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:30000', 'http://127.0.0.1:30000'];

/** True for failures caused by another running gateway owning the link port or the db. */
function isInstanceConflict(err: unknown): boolean {
  if (err instanceof LinkListenError) return err.code === 'EADDRINUSE';
  const e = err as { errcode?: number; message?: string } | null;
  return e?.errcode === 5 || /database is locked/i.test(e?.message ?? '');
}

/** Bind and release the link port, so a taken port fails before the store is opened. */
async function probeLinkPort(port: number): Promise<void> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', (err) => reject(mapListenError(err, port)));
    probe.listen(port, '127.0.0.1', () => resolve());
  });
  await new Promise<void>((resolve) => probe.close(() => resolve()));
}

export function defaultDbPath(): string {
  return join(homedir(), '.foundry-agent-gateway', 'gateway.db');
}

export interface ModuleConnection {
  readonly worldId: string;
  readonly userId: string;
}

export interface ModuleConnections {
  get(worldId: string, userId: string): ModuleConnection | undefined;
  any(): ModuleConnection | undefined;
}

/** Kept for the pre-routing server in mcp/server.ts; the app itself routes through the link registry. */
export class EmptyModuleConnections implements ModuleConnections {
  get(): undefined {
    return undefined;
  }
  any(): undefined {
    return undefined;
  }
}

export interface App {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface AppDeps {
  version: string;
  logger?: Logger;
  /** Which connected Foundry user the MCP session binds to; omitted means "the only one". */
  selector?: UserSelector;
  /** Exact `Origin` values the link accepts; defaults to a local Foundry on port 30000. */
  allowedOrigins?: readonly string[];
  dbPath?: string;
  /** Where the pairing code line goes; defaults to stderr (stdout carries MCP). */
  writeStatus?: (line: string) => void;
}

export function createApp(config: Config, deps: AppDeps): App {
  const logger = deps.logger ?? createLogger(config.logLevel);
  const writeStatus = deps.writeStatus ?? ((l: string) => void process.stderr.write(`${l}\n`));
  let server: Server | undefined;
  let link: LinkServer | undefined;
  let store: Store | undefined;
  let events: EventBuffer | undefined;
  let queue: OfflineQueue | undefined;
  return {
    async start() {
      try {
        await startPrimary();
      } catch (err) {
        await this.stop();
        // Only a conflict with another running gateway degrades. A real failure of the
        // only instance (corrupt db, permissions) must still exit 1 via reportStartFailure.
        if (!isInstanceConflict(err)) throw err;
        const reason = (err as Error).message;
        logger.error(`running without a Foundry link: ${reason}`);
        writeStatus(`Failed to start link: ${reason}`);
        server = createDegradedServer({ version: deps.version, reason });
        await server.connect(new StdioServerTransport());
        logger.info('MCP stdio server started (no Foundry link)');
      }
    },
    async stop() {
      await server?.close();
      server = undefined;
      queue?.close();
      queue = undefined;
      events?.close();
      events = undefined;
      await link?.close();
      link = undefined;
      store?.close();
      store = undefined;
    },
  };

  async function startPrimary(): Promise<void> {
    // Learn whether another gateway holds the link port before touching the shared db:
    // opening it runs migrations and retention deletes, which a secondary must not do.
    await probeLinkPort(config.linkPort);
    const dbPath = deps.dbPath ?? defaultDbPath();
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    store = openStore(dbPath);
    const registry = new LinkRegistry();
    const codes = new PairingCodes();
    events = new EventBuffer(store, registry);
    queue = new OfflineQueue(store, registry);
    events.startRetention();
    link = new LinkServer({
      port: config.linkPort,
      store,
      codes,
      registry,
      allowedOrigins: deps.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS,
      gatewayVersion: deps.version,
      events,
      queue,
    });
    const port = await link.listen();
    const pairingLine = `Pairing code: ${codes.generate()} (expires in ${PAIRING_CODE_TTL_MS / 60_000} min)`;
    const linkLine = `Link URL: ws://localhost:${port}`;
    writeStatus(pairingLine);
    writeStatus(linkLine);
    server = createSessionServer({
      version: deps.version,
      registry,
      events,
      queue,
      ...(deps.selector ? { selector: deps.selector } : {}),
      knownIdentities: () =>
        store?.listActivePairings().map((p) => ({
          worldId: p.worldId,
          userId: p.userId,
          userName: p.userName,
        })) ?? [],
      log: writeStatus,
    });
    await server.connect(new StdioServerTransport());
    logger.info(`MCP stdio server started`);
    // Hosts such as Claude Desktop hide stderr, so also offer the code as an MCP log message.
    void server
      .sendLoggingMessage({
        level: 'notice',
        logger: 'pairing',
        data: `${pairingLine}. ${linkLine}`,
      })
      .catch(() => undefined);
  }
}
