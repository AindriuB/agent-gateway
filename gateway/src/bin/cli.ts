#!/usr/bin/env node
import { closeSync, linkSync, openSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createApp, defaultDbPath } from '../app.js';
import { ConfigError, loadConfig } from '../config/index.js';
import { rotateToken } from '../http/token.js';
import { openStore } from '../store/index.js';
import { MIGRATIONS } from '../store/migrations/index.js';
import { reportStartFailure } from './start-failure.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const USAGE = `Usage: foundry-agent-gateway [options]

Options:
  --config <path>     Config file (JSON, must be chmod 600)
  --link-port <n>     Port for the module link (default 7420)
  --http              Also serve MCP over Streamable HTTP at http://127.0.0.1:7421/mcp
                      (bearer token printed once on first run)
  --http-port <n>     Port for --http (default 7421)
  --http-host <addr>  HTTP bind address (default 127.0.0.1; anything else needs --public-url)
  --link-host <addr>  Link bind address (default 127.0.0.1; anything else needs --public-url)
  --public-url <url>  The external https origin behind a reverse proxy that terminates TLS
                      (AGENT_GATEWAY_PUBLIC_URL). Turns HTTP on, turns the local bearer token
                      off, and keeps pairing codes out of MCP clients
  --server-mode       Always-on, many users (AGENT_GATEWAY_SERVER_MODE=1): no stdio session,
                      stays up when stdin closes, HTTP on
  --trust-proxy       Behind a reverse proxy on this host, key clients by X-Forwarded-For
                      (AGENT_GATEWAY_TRUST_PROXY=1)
  --http-rotate-token Generate a new HTTP bearer token, print it once, and exit. The old token
                      stops working at once, also in a gateway that is already running
  --backup <path>     Write a consistent copy of the database to a new file (mode 0600) and
                      exit; safe while the gateway runs
  --world <id>        Bind the MCP session to this Foundry world
  --user <name>       Bind the MCP session to this Foundry user (name or id)
  --allow-origin <o>  Optional: only this browser origin may reach the link (repeatable;
                      default: any http(s) origin, with a pairing code or its own token)
  --db <path>         SQLite file for pairings (default ~/.foundry-agent-gateway/gateway.db,
                      or AGENT_GATEWAY_DB)
  --version           Print version
  --help              Print this help
`;

/** Reduce each --allow-origin to a bare origin (no path, no trailing slash); http(s) only. */
function normalizeOrigins(values: readonly string[]): string[] {
  return values.map((v) => {
    let url: URL;
    try {
      url = new URL(v);
    } catch {
      process.stderr.write(
        `Invalid --allow-origin value: ${v} (include http:// or https://, e.g. https://foundry.local)\n`,
      );
      process.exit(2);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      process.stderr.write(
        `Invalid --allow-origin value: ${v} (include http:// or https://, e.g. https://foundry.local)\n`,
      );
      process.exit(2);
    }
    return url.origin;
  });
}

/** Why the db at `path` cannot be rotated without migrating it, or undefined when it is current. */
function schemaProblem(path: string): string | undefined {
  const start = 'start the gateway once to create or update it';
  if (!existsSync(path)) return `there is no database at ${path}; ${start}`;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const v = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (v < MIGRATIONS.length) return `the database is behind this version; ${start}`;
    if (v > MIGRATIONS.length)
      return 'this binary is older than the database; use the newer gateway';
    return undefined;
  } finally {
    db.close();
  }
}

/** One-shot: copy the db with VACUUM INTO, read-only, to a new 0600 file. Never migrates. */
function backup(dbOption: string | undefined, target: string): void {
  const dbPath = dbOption ?? defaultDbPath();
  if (dbPath === ':memory:') {
    process.stderr.write('--backup needs a database file, not :memory:\n');
    process.exit(2);
  }
  const out = resolve(target);
  const fail = (why: string): never => {
    process.stderr.write(`Could not back up the database: ${why}\n`);
    return process.exit(1);
  };
  const problem = (() => {
    try {
      return schemaProblem(dbPath);
    } catch (err) {
      return (err as Error).message;
    }
  })();
  if (problem) fail(problem);
  if (existsSync(out)) fail(`${out} already exists; it was left unchanged`);
  // Written beside the target and linked into place, so a failure leaves nothing at `out`
  // and an existing file is never replaced.
  const tmp = `${out}.partial-${process.pid}`;
  let error: string | undefined;
  try {
    closeSync(openSync(tmp, 'wx', 0o600));
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
    } finally {
      db.close();
    }
    linkSync(tmp, out);
  } catch (err) {
    error =
      (err as NodeJS.ErrnoException).code === 'EEXIST' && existsSync(out)
        ? `${out} already exists; it was left unchanged`
        : (err as Error).message;
  }
  try {
    unlinkSync(tmp);
  } catch {
    // Nothing to clean up.
  }
  if (error !== undefined) fail(error);
  process.stdout.write(`Backup written: ${out} (${statSync(out).size} bytes)\n`);
}

/**
 * One-shot: write the new hash to the store and exit. A running gateway reads the hash from the
 * store on every request, so the old token stops working and the new one starts working the
 * moment this commits. The token is printed only after the write succeeded.
 */
function rotate(dbOption: string | undefined): void {
  const dbPath = dbOption ?? defaultDbPath();
  if (dbPath === ':memory:') {
    process.stderr.write('--http-rotate-token needs a database file, not :memory:\n');
    process.exit(2);
  }
  try {
    // Rotation must never migrate a db that a running gateway owns: check the schema read-only.
    const problem = schemaProblem(dbPath);
    if (problem) {
      process.stderr.write(
        `Could not rotate the HTTP token: ${problem}; the old token is unchanged\n`,
      );
      process.exit(1);
    }
    const store = openStore(dbPath);
    try {
      const token = rotateToken(store);
      process.stderr.write(`HTTP bearer token (shown once, stored hashed): ${token}\n`);
      process.stderr.write('The previous token no longer works.\n');
    } finally {
      store.close();
    }
  } catch (err) {
    process.stderr.write(
      `Could not rotate the HTTP token (${(err as Error).message}); the old token is unchanged\n`,
    );
    process.exit(1);
  }
}

function main(): void {
  let values;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        version: { type: 'boolean' },
        help: { type: 'boolean' },
        config: { type: 'string' },
        'link-port': { type: 'string' },
        http: { type: 'boolean' },
        'http-port': { type: 'string' },
        'http-host': { type: 'string' },
        'link-host': { type: 'string' },
        'public-url': { type: 'string' },
        'server-mode': { type: 'boolean' },
        'trust-proxy': { type: 'boolean' },
        backup: { type: 'string' },
        'http-rotate-token': { type: 'boolean' },
        world: { type: 'string' },
        user: { type: 'string' },
        'allow-origin': { type: 'string', multiple: true },
        db: { type: 'string' },
      },
      strict: true,
    }));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n${USAGE}`);
    process.exit(2);
  }
  if (values.version) {
    process.stdout.write(`${pkg.version}\n`);
    return;
  }
  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (values['http-rotate-token']) {
    // Remote clients sign in with OAuth; there is no static token to rotate on a public gateway.
    if (values['public-url'] !== undefined || (process.env.AGENT_GATEWAY_PUBLIC_URL ?? '') !== '') {
      process.stderr.write(
        '--http-rotate-token cannot be used with --public-url (or AGENT_GATEWAY_PUBLIC_URL): the HTTP bearer token is off on a public gateway\n',
      );
      process.exit(2);
    }
    rotate(values.db ?? process.env.AGENT_GATEWAY_DB);
    return;
  }
  if (values.backup !== undefined) {
    backup(values.db ?? process.env.AGENT_GATEWAY_DB, values.backup);
    return;
  }
  let config;
  try {
    config = loadConfig({
      configPath: values.config,
      flags: {
        linkPort: values['link-port'],
        httpPort: values['http-port'],
        http: values.http,
        allowOrigin: values['allow-origin'],
        publicUrl: values['public-url'],
        serverMode: values['server-mode'],
        linkHost: values['link-host'],
        httpHost: values['http-host'],
        trustProxy: values['trust-proxy'],
      },
      onIgnored: (m) => process.stderr.write(`${m}\n`),
    });
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(err.exitCode);
    }
    throw err;
  }
  // An empty value (a cleared host setting) means no restriction.
  const allowOrigins = config.allowOrigin.filter((v) => v !== '');
  const app = createApp(config, {
    version: pkg.version,
    ...(config.http || config.publicUrl !== '' || config.serverMode ? { http: true } : {}),
    selector: { world: values.world, user: values.user },
    ...(allowOrigins.length ? { allowedOrigins: normalizeOrigins(allowOrigins) } : {}),
    ...((values.db ?? process.env.AGENT_GATEWAY_DB)
      ? { dbPath: values.db ?? process.env.AGENT_GATEWAY_DB }
      : {}),
  });
  const shutdown = () => void app.stop().finally(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  // A server-mode gateway runs in a container or service whose stdin may be closed.
  if (!config.serverMode) process.stdin.once('end', shutdown);
  app.start().catch((err: unknown) =>
    reportStartFailure(err, {
      writeStderr: (line) => process.stderr.write(line),
      exit: (code) => process.exit(code),
    }),
  );
}

main();
