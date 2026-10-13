#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp, defaultDbPath } from '../app.js';
import { ConfigError, HTTP_BIND_HOST, loadConfig } from '../config/index.js';
import { rotateToken } from '../http/token.js';
import { openStore } from '../store/index.js';
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
  --http-host <addr>  Only 127.0.0.1 is accepted
  --http-rotate-token Generate a new HTTP bearer token, print it once, and exit. The old token
                      stops working at once, also in a gateway that is already running
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
    mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
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
  if (values['http-host'] !== undefined && values['http-host'] !== HTTP_BIND_HOST) {
    process.stderr.write(
      `Refusing --http-host ${values['http-host']}: local HTTP binds ${HTTP_BIND_HOST} only\n`,
    );
    process.exit(2);
  }
  if (values['http-rotate-token']) {
    rotate(values.db ?? process.env.AGENT_GATEWAY_DB);
    return;
  }
  let config;
  try {
    config = loadConfig({
      configPath: values.config,
      flags: { linkPort: values['link-port'], httpPort: values['http-port'] },
      onIgnored: (m) => process.stderr.write(`${m}\n`),
    });
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
  // An empty value (a cleared host setting) means no restriction.
  const allowOrigins = (values['allow-origin'] ?? []).filter((v) => v !== '');
  const app = createApp(config, {
    version: pkg.version,
    ...(values.http ? { http: true } : {}),
    selector: { world: values.world, user: values.user },
    ...(allowOrigins.length ? { allowedOrigins: normalizeOrigins(allowOrigins) } : {}),
    ...((values.db ?? process.env.AGENT_GATEWAY_DB)
      ? { dbPath: values.db ?? process.env.AGENT_GATEWAY_DB }
      : {}),
  });
  const shutdown = () => void app.stop().finally(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.stdin.once('end', shutdown);
  app.start().catch((err: unknown) =>
    reportStartFailure(err, {
      writeStderr: (line) => process.stderr.write(line),
      exit: (code) => process.exit(code),
    }),
  );
}

main();
