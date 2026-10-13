#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createApp } from '../app.js';
import { ConfigError, loadConfig } from '../config/index.js';
import { reportStartFailure } from './start-failure.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const USAGE = `Usage: foundry-agent-gateway [options]

Options:
  --config <path>     Config file (JSON, must be chmod 600)
  --link-port <n>     Port for the module link (default 7420)
  --world <id>        Bind the MCP session to this Foundry world
  --user <name>       Bind the MCP session to this Foundry user (name or id)
  --allow-origin <o>  Origin allowed to connect to the link (repeatable;
                      default http://localhost:30000 and http://127.0.0.1:30000)
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
  let config;
  try {
    config = loadConfig({ configPath: values.config, flags: { linkPort: values['link-port'] } });
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
  // An empty value (a cleared host setting) means "use the defaults".
  const allowOrigins = (values['allow-origin'] ?? []).filter((v) => v !== '');
  const app = createApp(config, {
    version: pkg.version,
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
