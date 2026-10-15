#!/usr/bin/env node
import { closeSync, linkSync, openSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createApp, defaultDbPath } from '../app.js';
import { ConfigError, loadConfig, normalizePublicUrl } from '../config/index.js';
import { rotateToken } from '../http/token.js';
import { canonicalOrigin } from '../link/origin.js';
import { INVITE_TTL_MS, createInvite, parseTtl } from '../link/invites.js';
import { safeText } from '../routing/sanitize.js';
import { openStore, type Store } from '../store/index.js';
import { MIGRATIONS } from '../store/migrations/index.js';
import { reportStartFailure } from './start-failure.js';
import { installShutdownSignals } from './signals.js';

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
  --privacy-url <url> Link to your privacy notice from the sign-in pages
                      (AGENT_GATEWAY_PRIVACY_URL; https, or http on loopback)
  --source-url <url>  Link to the source this gateway runs, from the sign-in pages
                      (AGENT_GATEWAY_SOURCE_URL; https, or http on loopback)
  --server-mode       Always-on, many users (AGENT_GATEWAY_SERVER_MODE=1): no stdio session,
                      stays up when stdin closes, HTTP on
  --trust-proxy       Behind a reverse proxy on this host, key clients by X-Forwarded-For
                      (AGENT_GATEWAY_TRUST_PROXY=1)
  --http-rotate-token Generate a new HTTP bearer token, print it once, and exit. The old token
                      stops working at once, also in a gateway that is already running
  --backup <path>     Write a consistent copy of the database to a new file (mode 0600) and
                      exit; safe while the gateway runs
  --invite <world id> <user id> [--ttl <30m|12h|7d>] [--origin <origin>] [--admin | --gm]
                      Server mode: print a single-use invite for exactly that Foundry world
                      and user, valid 24 h by default (at most 7 d), and exit. With --public-url
                      or AGENT_GATEWAY_PUBLIC_URL it is one paste-ready string,
                      wss://<host>/link#<CODE>; otherwise the bare code. Give it to that
                      person; redeeming it replaces any existing pairing for them.
                      A plain invite is for players: it needs a live admin GM to confirm it
                      --admin  Admin GM invite: pairs directly and sets the admin flag. Only
                               the operator can make one. Needs --origin; valid 1 h by default
                               (at most 24 h)
                      --gm     Invite for an additional GM user account (for example a
                               "ChatGPT" GM). It skips the GM vouch, so use it only for GM user
                               accounts, never for players. Same rules as --admin, but the
                               pairing is not admin
  --demote <world id> <user id>
                      Clear the admin flag on that user's active pairing and exit (exit 1 if
                      it was not an admin). The pairing, its grants and invites stay; a running
                      gateway stops accepting that GM's vouches at once
  --revoke-pairing <world id> <user id>
                      Revoke that user's pairing and OAuth grants and cancel their unused
                      invites, then exit; a running gateway disconnects them within seconds
  --cancel-invite <world id> <user id>
                      Cancel that user's unused invites and exit (exit 1 if there were none)
  --list-invites      List invites (id, target, kind, created, expiry, status; never the code), exit
  --list-pairings     List pairings (world, user, admin, name, origin, created, revoked), exit
  --headless-foundry-url <url>
                      Run one agent with no browser open (AGENT_GATEWAY_HEADLESS_FOUNDRY_URL):
                      the gateway launches Chromium, logs into this Foundry as the agent user
                      and pairs it itself. Needs --headless-world and --headless-user, and the
                      password in AGENT_GATEWAY_HEADLESS_PASSWORD (or the 0600 --config file's
                      headlessPassword); there is no password flag
  --headless-world <id>  World id the agent joins (AGENT_GATEWAY_HEADLESS_WORLD)
  --headless-user <id>   Foundry user id of the agent (AGENT_GATEWAY_HEADLESS_USER); an id, not a name
  --world <id>        Bind the MCP session to this Foundry world
  --user <name>       Bind the MCP session to this Foundry user (name or id)
  --allow-origin <o>  Optional: only this browser origin may reach the link (repeatable;
                      default: any http(s) origin, with a pairing code or its own token)
  --db <path>         SQLite file for pairings (default ~/.foundry-agent-gateway/gateway.db,
                      or AGENT_GATEWAY_DB)
  --version           Print version
  --help              Print this help
`;

/** Admin and GM invites: a leaked code pairs with no vouch, so the window is short. */
const ADMIN_INVITE_TTL_MS = 60 * 60 * 1000;
const MAX_ADMIN_INVITE_TTL_MS = 24 * 60 * 60 * 1000;

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

type OperatorCommand =
  | {
      kind: 'invite';
      worldId: string;
      userId: string;
      ttlMs: number;
      origin?: string;
      admin: boolean;
      gm: boolean;
    }
  | { kind: 'revoke-pairing' | 'cancel-invite' | 'demote'; worldId: string; userId: string }
  | { kind: 'list-invites' | 'list-pairings' };

/** Validate the one-shot operator commands' arguments; exits 2 on a bad combination. */
function operatorCommandOf(
  values: {
    invite?: boolean | undefined;
    'revoke-pairing'?: boolean | undefined;
    'cancel-invite'?: boolean | undefined;
    demote?: boolean | undefined;
    admin?: boolean | undefined;
    gm?: boolean | undefined;
    'list-invites'?: boolean | undefined;
    'list-pairings'?: boolean | undefined;
    ttl?: string | undefined;
    origin?: string | undefined;
  },
  positionals: readonly string[],
): OperatorCommand | undefined {
  const usage = (why: string): never => {
    process.stderr.write(`${why}\n${USAGE}`);
    return process.exit(2);
  };
  const kinds = (
    [
      'invite',
      'revoke-pairing',
      'cancel-invite',
      'demote',
      'list-invites',
      'list-pairings',
    ] as const
  ).filter((k) => values[k]);
  if (kinds.length === 0) {
    if (values.ttl !== undefined || values.origin !== undefined)
      usage('--ttl and --origin go with --invite');
    if (values.admin) usage('--admin goes with --invite');
    if (values.gm) usage('--gm goes with --invite');
    return undefined;
  }
  if (kinds.length > 1) usage(`Use one of --${kinds.join(', --')} at a time`);
  const kind = kinds[0] as (typeof kinds)[number];
  if (kind !== 'invite' && (values.ttl !== undefined || values.origin !== undefined))
    usage('--ttl and --origin go with --invite');
  if (kind !== 'invite' && values.admin) usage('--admin goes with --invite');
  if (kind !== 'invite' && values.gm) usage('--gm goes with --invite');
  if (kind === 'list-invites' || kind === 'list-pairings') {
    if (positionals.length > 0) usage(`--${kind} takes no arguments`);
    return { kind };
  }
  const [worldId, userId] = positionals;
  if (positionals.length !== 2 || !worldId || !userId || worldId.length > 64 || userId.length > 64)
    usage(`--${kind} needs <world id> <user id> (each 1 to 64 characters)`);
  if (kind !== 'invite') return { kind, worldId: worldId!, userId: userId! };
  const admin = values.admin === true;
  const gm = values.gm === true;
  const privileged = admin || gm;
  const flagName = admin ? '--admin' : '--gm';
  if (privileged && values.origin === undefined)
    usage(`${flagName} needs --origin (the exact browser origin of that Foundry)`);
  let ttlMs = privileged ? ADMIN_INVITE_TTL_MS : INVITE_TTL_MS;
  if (values.ttl !== undefined) {
    const parsed = parseTtl(values.ttl);
    if (privileged) {
      if (parsed === undefined || parsed > MAX_ADMIN_INVITE_TTL_MS)
        return usage(`--ttl with ${flagName} must be like 30m or 12h, at most 24h`);
    } else if (parsed === undefined) return usage('--ttl must be like 30m, 12h or 7d, at most 7d');
    ttlMs = parsed;
  }
  let origin: string | undefined;
  if (values.origin !== undefined) {
    origin = canonicalOrigin(values.origin);
    if (origin === undefined)
      usage('--origin must be an exact http(s) origin such as https://foundry.example.com');
  }
  return {
    kind,
    worldId: worldId!,
    userId: userId!,
    ttlMs,
    admin,
    gm: privileged,
    ...(origin !== undefined ? { origin } : {}),
  };
}

/** The `ws(s)://<host>/link` address from `--public-url`, then AGENT_GATEWAY_PUBLIC_URL; none if unset. */
function invitePublicLink(): string | undefined {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { 'public-url': { type: 'string' } },
    strict: false,
  });
  const flag = values['public-url'];
  const raw = typeof flag === 'string' ? flag : process.env.AGENT_GATEWAY_PUBLIC_URL;
  if (raw === undefined || raw === '') return undefined;
  try {
    const origin = normalizePublicUrl(raw);
    return `${origin.replace(/^http/, 'ws')}/link`;
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    process.stderr.write(`${err.message}\n`);
    return process.exit(2);
  }
}

/** The one-paste invite string, or the bare code when there is no public address. */
function formatInvite(code: string, link: string | undefined): string {
  return link ? `${link}#${code}` : code;
}

const when = (ms: number | null): string => (ms === null ? '-' : new Date(ms).toISOString());

/**
 * The one-shot operator commands. Like `rotate`, each checks the schema read-only first and never
 * migrates a database a running gateway owns. Every write runs in `BEGIN IMMEDIATE ... COMMIT`,
 * so the write lock is taken first and busy_timeout covers the wait; on any error nothing changed.
 */
function runOperatorCommand(cmd: OperatorCommand, dbOption: string | undefined): void {
  const dbPath = dbOption ?? defaultDbPath();
  const flag = `--${cmd.kind}`;
  if (dbPath === ':memory:') {
    process.stderr.write(`${flag} needs a database file, not :memory:\n`);
    process.exit(2);
  }
  const writes = cmd.kind !== 'list-invites' && cmd.kind !== 'list-pairings';
  let store: Store | undefined;
  try {
    const problem = schemaProblem(dbPath);
    if (problem) {
      process.stderr.write(`${flag} failed: ${problem}${writes ? '; nothing changed' : ''}\n`);
      process.exit(1);
    }
    store = openStore(dbPath);
    const s = store;
    switch (cmd.kind) {
      case 'invite': {
        // Validate the public URL first, so a bad one creates no invite.
        const link = invitePublicLink();
        const made = s.transaction(() => createInvite(s, cmd, Date.now()));
        // The code goes to stdout alone; it is never logged or stored.
        process.stdout.write(`${formatInvite(made.code, link)}\n`);
        process.stderr.write(
          `Invite for world ${safeText(cmd.worldId)}, user ${safeText(cmd.userId)}${cmd.origin ? `, origin ${safeText(cmd.origin)}` : ''}, expires ${when(made.expiresAt)}. It is shown once and works once.\n`,
        );
        if (link)
          process.stderr.write(
            'Players on an older module enter only the part after # as the pairing code.\n',
          );
        break;
      }
      case 'revoke-pairing': {
        const out = s.revokePairingsFor(cmd.worldId, cmd.userId);
        process.stdout.write(
          `Revoked ${out.pairings.length} pairing(s) and cancelled ${out.cancelledInvites} unused invite(s) for world ${safeText(cmd.worldId)}, user ${safeText(cmd.userId)}.\n`,
        );
        break;
      }
      case 'demote': {
        const n = s.transaction(() => {
          let changed = 0;
          for (const p of s.listActivePairings())
            if (p.worldId === cmd.worldId && p.userId === cmd.userId && p.admin)
              if (s.demotePairing(p.id)) changed++;
          return changed;
        });
        if (n === 0) {
          process.stderr.write(
            `No active admin pairing for world ${safeText(cmd.worldId)}, user ${safeText(cmd.userId)}; nothing changed\n`,
          );
          process.exitCode = 1;
        } else
          process.stdout.write(
            `Demoted ${n} pairing(s) for world ${safeText(cmd.worldId)}, user ${safeText(cmd.userId)}; the pairing and its grants are kept.\n`,
          );
        break;
      }
      case 'cancel-invite': {
        const n = s.transaction(() => s.invites.cancelFor(cmd.worldId, cmd.userId));
        if (n === 0) {
          process.stderr.write(
            `No unused invite for world ${safeText(cmd.worldId)}, user ${safeText(cmd.userId)}; nothing changed\n`,
          );
          process.exitCode = 1;
        } else process.stdout.write(`Cancelled ${n} unused invite(s).\n`);
        break;
      }
      case 'list-invites': {
        const at = Date.now();
        for (const i of s.invites.list()) {
          const status = i.result ?? (i.expiresAt <= at ? 'expired' : 'live');
          process.stdout.write(
            `${i.id.slice(0, 8)}  ${safeText(i.worldId)}  ${safeText(i.userId)}  kind ${i.admin ? 'admin' : i.gm ? 'gm' : '-'}  created ${when(i.createdAt)}  expires ${when(i.expiresAt)}  ${status}${i.origin ? `  origin ${safeText(i.origin)}` : ''}\n`,
          );
        }
        break;
      }
      case 'list-pairings':
        for (const p of s.listPairings()) {
          process.stdout.write(
            `${safeText(p.worldId)}  ${safeText(p.userId)}  ${p.admin ? 'admin' : '-'}  ${safeText(p.userName)}  ${p.origin ? safeText(p.origin) : '-'}  created ${when(p.createdAt)}  revoked ${when(p.revokedAt)}\n`,
          );
        }
        break;
    }
  } catch (err) {
    const msg = (err as Error).message;
    const busy = /locked|busy/i.test(msg);
    process.stderr.write(
      `${flag} failed (${busy ? 'the database is busy' : safeText(msg)})${writes ? '; nothing changed' : ''}\n`,
    );
    process.exitCode = 1;
  } finally {
    store?.close();
  }
}

function main(): void {
  let values;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
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
        'privacy-url': { type: 'string' },
        'source-url': { type: 'string' },
        'server-mode': { type: 'boolean' },
        'trust-proxy': { type: 'boolean' },
        'headless-foundry-url': { type: 'string' },
        'headless-world': { type: 'string' },
        'headless-user': { type: 'string' },
        backup: { type: 'string' },
        invite: { type: 'boolean' },
        'revoke-pairing': { type: 'boolean' },
        'cancel-invite': { type: 'boolean' },
        demote: { type: 'boolean' },
        admin: { type: 'boolean' },
        gm: { type: 'boolean' },
        'list-invites': { type: 'boolean' },
        'list-pairings': { type: 'boolean' },
        ttl: { type: 'string' },
        origin: { type: 'string' },
        'http-rotate-token': { type: 'boolean' },
        world: { type: 'string' },
        user: { type: 'string' },
        'allow-origin': { type: 'string', multiple: true },
        db: { type: 'string' },
      },
      strict: true,
      allowPositionals: true,
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
  const operatorCommand = operatorCommandOf(values, positionals);
  if (operatorCommand) {
    runOperatorCommand(operatorCommand, values.db ?? process.env.AGENT_GATEWAY_DB);
    return;
  }
  if (positionals.length > 0) {
    process.stderr.write(`Unexpected argument: ${positionals[0]}\n${USAGE}`);
    process.exit(2);
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
        privacyUrl: values['privacy-url'],
        sourceUrl: values['source-url'],
        serverMode: values['server-mode'],
        linkHost: values['link-host'],
        httpHost: values['http-host'],
        trustProxy: values['trust-proxy'],
        headlessFoundryUrl: values['headless-foundry-url'],
        headlessWorld: values['headless-world'],
        headlessUser: values['headless-user'],
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
  installShutdownSignals(shutdown);
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
