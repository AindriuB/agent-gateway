import { OfflineQueue } from './offline-queue/service.js';
import { EventBuffer } from './events/index.js';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Readable, Writable } from 'node:stream';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Config } from './config/index.js';
import { LinkListenError } from './link/server.js';
import { LinkRegistry, LinkServer, PairingCodes, PAIRING_CODE_TTL_MS } from './link/index.js';
import { createLogger, type Logger } from './log.js';
import { createDegradedServer } from './mcp/degraded.js';
import { createSessionServer } from './mcp/session.js';
import type { UserSelector } from './routing/index.js';
import { openStore, type Store } from './store/index.js';
import {
  LocalUpstream,
  makeRelayConfig,
  RelaySecondary,
  RelayServer,
  relayEndpoint,
  StdioRelayProxy,
} from './relay/index.js';

/** True for failures caused by another running gateway owning the link port or the db. */
function isInstanceConflict(err: unknown): boolean {
  if (err instanceof LinkListenError) return err.code === 'EADDRINUSE';
  const e = err as { errcode?: number; message?: string } | null;
  return e?.errcode === 5 || /database is locked/i.test(e?.message ?? '');
}

const MAX_WARNED_ORIGINS = 20;
const MAX_ORIGIN_CHARS = 100;

/** Make an untrusted Origin header safe for a log line: printable ASCII only, bounded. */
export function sanitizeOrigin(origin: string | undefined): string {
  if (origin === undefined) return '(absent)';
  const clean = origin.replace(/[^\x21-\x7e]/g, '?');
  return clean.length > MAX_ORIGIN_CHARS ? `${clean.slice(0, MAX_ORIGIN_CHARS)}...` : clean;
}

export function defaultDbPath(): string {
  return join(homedir(), '.foundry-agent-gateway', 'gateway.db');
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
  /** Optional extra restriction: only these exact `Origin` values may reach the link. */
  allowedOrigins?: readonly string[];
  dbPath?: string;
  /** Where the pairing code line goes; defaults to stderr (stdout carries MCP). */
  writeStatus?: (line: string) => void;
  /** MCP stdio streams; default to the process's. Injectable for tests. */
  stdin?: Readable;
  stdout?: Writable;
  /** Store opener; injectable so tests can prove a relay never opens the db. */
  openStore?: typeof openStore;
  /**
   * A newer instance with different settings asked this primary to step down. Defaults to
   * stopping the app and exiting the process.
   */
  onStepDown?: (why: string) => void;
}

export function createApp(config: Config, deps: AppDeps): App {
  const logger = deps.logger ?? createLogger(config.logLevel);
  const writeStatus = deps.writeStatus ?? ((l: string) => void process.stderr.write(`${l}\n`));
  let server: Server | undefined;
  let link: LinkServer | undefined;
  let store: Store | undefined;
  let events: EventBuffer | undefined;
  let queue: OfflineQueue | undefined;
  let relay: RelayServer | undefined;
  let secondary: RelaySecondary | undefined;
  let stdioProxy: StdioRelayProxy | undefined;
  // The relay and its secret/socket files live in the db's directory; an in-memory db has none.
  const dbPath = deps.dbPath ?? defaultDbPath();
  const startedAt = Date.now();
  const relayConfig = () =>
    makeRelayConfig(deps.allowedOrigins ?? [], config.httpPort, config.logLevel, startedAt);
  const stateDir = dbPath === ':memory:' ? undefined : dirname(dbPath);
  const app: App = {
    async start() {
      try {
        // The client's stdio goes through the same proxy as a relay's, so every instance gets the
        // same stdout back-pressure, cap and oversized-line handling. It only starts reading
        // stdin once this instance really is the primary.
        const [sessionSide, stdioSide] = InMemoryTransport.createLinkedPair();
        try {
          await startPrimary(sessionSide);
        } catch (err) {
          void stdioSide.close();
          throw err;
        }
        await attachStdio(stdioSide);
      } catch (err) {
        await this.stop();
        // Only a conflict with another running gateway degrades. A real failure of the
        // only instance (corrupt db, permissions) must still exit 1 via reportStartFailure.
        if (!isInstanceConflict(err)) throw err;
        const reason = (err as Error).message;
        // One clear line; no pairing code, so only the instance that holds the port shows one.
        logger.error(
          err instanceof LinkListenError
            ? `pid ${process.pid}: another gateway holds link port ${err.port}; this instance cannot pair`
            : `pid ${process.pid}: another gateway holds the pairing database; this instance cannot pair`,
        );
        await startSecondary(reason);
      }
    },
    async stop() {
      stdioProxy?.stop();
      stdioProxy = undefined;
      await secondary?.stop();
      secondary = undefined;
      await relay?.close();
      relay = undefined;
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
  return app;

  function openedStore(): Store {
    if (!store) throw new Error('store is not open yet');
    return store;
  }

  /** Serve the in-process session to the client on stdio, through the bounded proxy. */
  async function attachStdio(stdioSide: InMemoryTransport, exitWhenGone = false): Promise<void> {
    const proxy = new StdioRelayProxy(
      deps.stdin ?? process.stdin,
      deps.stdout ?? process.stdout,
      writeStatus,
    );
    // A client that stops reading is dropped; a primary keeps serving other instances' sessions.
    proxy.onClientGone = () => {
      if (exitWhenGone) void app.stop().finally(() => process.exit(0));
    };
    const up = new LocalUpstream(stdioSide);
    await up.start();
    stdioProxy = proxy;
    proxy.attach(up);
    proxy.start();
  }

  async function startRelay(linkPort: number, createSession: () => Server): Promise<void> {
    const ep = stateDir ? relayEndpoint(stateDir, linkPort) : undefined;
    if (!stateDir || !ep) return;
    if (!ep.ok) {
      writeStatus(
        `relay off: ${ep.reason}; other gateway instances will only answer gateway_status`,
      );
      return;
    }
    const candidate = new RelayServer({
      endpoint: ep.path,
      stateDir,
      linkPort,
      selector: deps.selector ?? {},
      createSession,
      log: writeStatus,
      config: relayConfig(),
      onStepDown: (why) => {
        writeStatus(`stepping down: a newer gateway instance has different settings (${why})`);
        if (deps.onStepDown) deps.onStepDown(why);
        else void app.stop().finally(() => process.exit(0));
      },
    });
    try {
      await candidate.listen();
      relay = candidate;
    } catch (err) {
      writeStatus(
        `relay off: ${(err as Error).message}; other gateway instances will only answer gateway_status`,
      );
    }
  }

  /** Undo a failed or finished startPrimary. */
  async function teardown(): Promise<void> {
    await relay?.close();
    relay = undefined;
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
  }

  async function startSecondary(reason: string): Promise<void> {
    const ep = stateDir ? relayEndpoint(stateDir, config.linkPort) : undefined;
    if (!stateDir || !ep?.ok) {
      const why = ep && !ep.ok ? ep.reason : 'this instance has no state directory';
      server = createDegradedServer({
        version: deps.version,
        reason: `${reason} (relaying is off: ${why})`,
      });
      const [sessionSide, stdioSide] = InMemoryTransport.createLinkedPair();
      await server.connect(sessionSide);
      await attachStdio(stdioSide, true);
      return;
    }
    secondary = new RelaySecondary({
      endpoint: ep.path,
      stateDir,
      linkPort: config.linkPort,
      selector: deps.selector ?? {},
      config: relayConfig(),
      input: deps.stdin ?? process.stdin,
      output: deps.stdout ?? process.stdout,
      log: writeStatus,
      async becomePrimary(transport) {
        // Outside the try: teardown must never run against a live primary.
        if (link) throw new Error('this process already holds the link');
        try {
          await startPrimary(transport);
          return true;
        } catch (err) {
          await teardown();
          if (isInstanceConflict(err)) return false;
          throw err;
        }
      },
      onClientGone: () => {
        // A relay with no client has no purpose; a primary still serves other instances' sessions.
        if (!link) void app.stop().finally(() => process.exit(0));
      },
      createDegraded: (why) => createDegradedServer({ version: deps.version, reason: why }),
    });
    await secondary.start(reason);
  }

  async function startPrimary(transport: Transport): Promise<void> {
    // Never start over a live primary: it would replace `link` and orphan the original.
    if (link) throw new Error('this process already holds the link');
    // Hold the link port before touching the shared db: opening it runs migrations and
    // retention deletes, which a secondary instance must never do. A loser fails here with
    // EADDRINUSE. The store is opened in the same tick as listen resolves, before any
    // connection can be handled, so the lazy getters below are never read while unset.
    const registry = new LinkRegistry();
    const codes = new PairingCodes();
    const warned = new Set<string>();
    link = new LinkServer({
      port: config.linkPort,
      onOriginRejected: (origin, reason) => {
        const shown = sanitizeOrigin(origin);
        const key = `${shown} ${reason}`;
        if (warned.has(key) || warned.size >= MAX_WARNED_ORIGINS) return;
        warned.add(key);
        const where =
          reason === 'no valid pairing code'
            ? " The code is in this log or the client's MCP log."
            : '';
        writeStatus(`rejected link connection from origin ${shown}: ${reason}.${where}`);
      },
      get store() {
        return openedStore();
      },
      codes,
      registry,
      ...(deps.allowedOrigins?.length ? { allowedOrigins: deps.allowedOrigins } : {}),
      gatewayVersion: deps.version,
      get events() {
        return events;
      },
      get queue() {
        return queue;
      },
    });
    const port = await link.listen();
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    store = (deps.openStore ?? openStore)(dbPath);
    events = new EventBuffer(store, registry);
    queue = new OfflineQueue(store, registry);
    events.startRetention();
    const pairingLine = `Pairing code: ${codes.generate()} (expires in ${PAIRING_CODE_TTL_MS / 60_000} min)`;
    const linkLine = `Link URL: ws://localhost:${port} (pid ${process.pid} holds link port ${port})`;
    writeStatus(pairingLine);
    writeStatus(linkLine);
    const sessionOptions = (e: EventBuffer, q: OfflineQueue) => ({
      version: deps.version,
      registry,
      events: e,
      queue: q,
      ...(deps.selector ? { selector: deps.selector } : {}),
      knownIdentities: () =>
        store?.listActivePairings().map((p) => ({
          worldId: p.worldId,
          userId: p.userId,
          userName: p.userName,
        })) ?? [],
      log: writeStatus,
    });
    const ready = { events, queue };
    server = createSessionServer(sessionOptions(ready.events, ready.queue));
    // Hosts such as Claude Desktop hide stderr, so also offer the code as an MCP log message.
    // Only after the client has finished its handshake: a notification before `initialize` is
    // out of order and some clients drop or reject it. Relayed sessions never send it.
    const notice = `${pairingLine}. ${linkLine}`;
    const primarySession = server;
    primarySession.oninitialized = () =>
      void primarySession
        .sendLoggingMessage({ level: 'notice', logger: 'pairing', data: notice })
        .catch(() => undefined);
    await server.connect(transport);
    // Relayed sessions are accepted only once everything they share is ready.
    await startRelay(port, () => createSessionServer(sessionOptions(ready.events, ready.queue)));
    logger.info(`MCP stdio server started`);
  }
}
