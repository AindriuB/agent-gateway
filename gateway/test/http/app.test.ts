import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../../src/app.js';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { applyMigrations } from '../../src/store/migrate.js';
import { MIGRATIONS } from '../../src/store/migrations/index.js';
import { openStore } from '../../src/store/index.js';
import { freePort, tempState, until } from '../relay/harness.js';

const config = (linkPort: number, httpPort: number) =>
  ({ linkPort, httpPort, logLevel: 'error' }) as unknown as Parameters<typeof createApp>[0];

const reachable = async (port: number): Promise<boolean> =>
  fetch(`http://127.0.0.1:${port}/status`).then(
    (r) => r.status === 200,
    () => false,
  );

describe('--http in the app', () => {
  const apps: App[] = [];
  const cleanups: (() => void)[] = [];
  afterEach(async () => {
    for (const a of apps.splice(0)) await a.stop();
    for (const c of cleanups.splice(0)) c();
  });

  /** A manual timer: the retry waits until the test fires it. */
  function manualTimers() {
    const t = {
      pending: undefined as { fn: () => void; ms: number } | undefined,
      armed: 0,
      cleared: 0,
      fire() {
        const p = t.pending;
        t.pending = undefined;
        p?.fn();
      },
      setTimer(fn: () => void, ms: number) {
        t.armed++;
        t.pending = { fn, ms };
        return t.pending;
      },
      clearTimer(h: unknown) {
        t.cleared++;
        if (t.pending === h) t.pending = undefined;
      },
    };
    return t;
  }

  function mk(
    linkPort: number,
    httpPort: number,
    dbPath: string,
    http: boolean,
    httpRetryTimers?: ReturnType<typeof manualTimers>,
    openStoreFn?: typeof openStore,
  ) {
    const lines: string[] = [];
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let out = '';
    stdout.on('data', (d: Buffer) => (out += d.toString()));
    const app = createApp(config(linkPort, httpPort), {
      version: '0.0.0-test',
      dbPath,
      stdin,
      stdout,
      writeStatus: (l) => lines.push(l),
      ...(http ? { http: true } : {}),
      ...(httpRetryTimers ? { httpRetryTimers } : {}),
      ...(openStoreFn ? { openStore: openStoreFn } : {}),
    });
    apps.push(app);
    return { app, lines, stdin, out: () => out };
  }

  async function blockedTakeover() {
    const state = tempState();
    cleanups.push(state.cleanup);
    const link = await freePort();
    let port = await freePort();
    while (port === link) port = await freePort();
    const primary = mk(link, port, state.db, false);
    await primary.app.start();
    const blocker = createServer().listen(port, '127.0.0.1');
    await new Promise((r) => blocker.once('listening', r));
    const timers = manualTimers();
    const successor = mk(link, port, state.db, true, timers);
    await successor.app.start();
    await primary.app.stop();
    await until(
      () => successor.lines.some((l) => l.startsWith('HTTP off')),
      20_000,
      'HTTP retry notice',
    );
    return { state, port, blocker, timers, successor };
  }

  it('only the primary serves HTTP; a secondary says so, and takes over when the primary stops', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const link = await freePort();
    let portA = await freePort();
    while (portA === link) portA = await freePort();
    const primary = mk(link, portA, state.db, true);
    await primary.app.start();
    expect(await reachable(portA)).toBe(true);
    expect(primary.lines.filter((l) => l.startsWith('HTTP bearer token'))).toHaveLength(1);

    const secondary = mk(link, portA, state.db, true);
    await secondary.app.start();
    expect(
      secondary.lines.filter((l) => l.includes('HTTP is served only by the primary')),
    ).toHaveLength(1);
    // A second listener on the same port would fail; the secondary must not even try.
    expect(secondary.lines.some((l) => l.includes('/mcp'))).toBe(false);

    await primary.app.stop();
    await until(() => secondary.lines.some((l) => l.includes('/mcp')), 20_000, 'takeover');
    expect(await reachable(portA)).toBe(true);
    // The token was created once; the successor reuses the stored hash.
    expect(secondary.lines.filter((l) => l.startsWith('HTTP bearer token'))).toHaveLength(0);
  }, 40_000);

  it('leaves no token behind when the HTTP port is taken, and prints one on the next run', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const link = await freePort();
    let port = await freePort();
    while (port === link) port = await freePort();
    const blocker = createServer().listen(port, '127.0.0.1');
    await new Promise((r) => blocker.once('listening', r));
    const failing = mk(link, port, state.db, true);
    await expect(failing.app.start()).rejects.toThrow(/EADDRINUSE/);
    expect(failing.lines.some((l) => l.startsWith('HTTP bearer token'))).toBe(false);
    const check = openStore(state.db);
    expect(check.getHttpTokenHash()).toBeUndefined();
    check.close();
    await new Promise((r) => blocker.close(r));
    const retry = mk(link, port, state.db, true);
    await retry.app.start();
    const line = retry.lines.find((l) => l.startsWith('HTTP bearer token')) ?? '';
    const tok = line.split(': ')[1] ?? '';
    expect(tok).toMatch(/^[0-9a-f]{64}$/);
    expect(await status(port, tok)).toBe(200);
  }, 20_000);

  it('--http-rotate-token takes effect in a running primary', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const link = await freePort();
    let port = await freePort();
    while (port === link) port = await freePort();
    const primary = mk(link, port, state.db, true);
    await primary.app.start();
    const oldTok = (primary.lines.find((l) => l.startsWith('HTTP bearer token')) ?? '').split(
      ': ',
    )[1]!;
    expect(await status(port, oldTok)).toBe(200);
    const r = spawnSync(process.execPath, [cli, '--http-rotate-token', '--db', state.db], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(r.status).toBe(0);
    const newTok = /: ([0-9a-f]{64})/.exec(r.stderr)?.[1];
    expect(newTok).toBeTruthy();
    expect(newTok).not.toBe(oldTok);
    expect(await status(port, oldTok)).toBe(401);
    expect(await status(port, newTok!)).toBe(200);
    const check = openStore(state.db);
    expect(check.getHttpTokenHash()).toBe(createHash('sha256').update(newTok!).digest('hex'));
    check.close();
  }, 30_000);

  it('a takeover with the HTTP port blocked stays primary, then brings HTTP up when the port frees', async () => {
    const { state, port, blocker, timers, successor } = await blockedTakeover();
    expect(successor.lines).toContain(`HTTP off: 127.0.0.1:${port} in use; retrying`);
    expect(successor.lines.some((l) => l.startsWith('takeover failed'))).toBe(false);
    expect(timers.pending?.ms).toBe(5000);
    // It is the primary: the link is held and the tools answer.
    successor.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } })}\n`,
    );
    successor.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    await until(() => successor.out().includes('"id":2'), 10_000, 'tools/list');
    expect(successor.out()).toContain('world_info');
    // No hash and no token while HTTP is off.
    const check = openStore(state.db);
    expect(check.getHttpTokenHash()).toBeUndefined();
    check.close();
    expect(successor.lines.some((l) => l.startsWith('HTTP bearer token'))).toBe(false);
    // Still blocked: the retry re-arms with a longer delay and still stores nothing.
    timers.fire();
    await until(() => timers.pending !== undefined, 5000, 're-armed timer');
    expect(timers.pending?.ms).toBe(10_000);
    // Freed: the next attempt serves HTTP and prints one working token.
    await new Promise((r) => blocker.close(r));
    timers.fire();
    await until(
      () => successor.lines.some((l) => l.startsWith('HTTP bearer token')),
      5000,
      'token line',
    );
    expect(successor.lines.filter((l) => l.startsWith('HTTP bearer token'))).toHaveLength(1);
    const tok =
      (successor.lines.find((l) => l.startsWith('HTTP bearer token')) ?? '').split(': ')[1] ?? '';
    expect(tok).toMatch(/^[0-9a-f]{64}$/);
    expect(await status(port, tok)).toBe(200);
    expect(timers.pending).toBeUndefined();
  }, 40_000);

  it('a commit failure after a successful takeover listen releases the port and recovers', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const link = await freePort();
    let port = await freePort();
    while (port === link) port = await freePort();
    const primary = mk(link, port, state.db, false);
    await primary.app.start();
    let failCommit = true;
    const flaky: typeof openStore = (path) => {
      const store = openStore(path);
      const set = store.setHttpTokenHash.bind(store);
      store.setHttpTokenHash = (hash, onlyIfAbsent) => {
        if (failCommit) throw new Error('database is busy');
        return set(hash, onlyIfAbsent);
      };
      return store;
    };
    const timers = manualTimers();
    const successor = mk(link, port, state.db, true, timers, flaky);
    await successor.app.start();
    await primary.app.stop();
    await until(
      () => successor.lines.some((l) => l.startsWith('HTTP off')),
      20_000,
      'HTTP retry notice',
    );
    expect(successor.lines).toContain('HTTP off: database is busy; retrying');
    // The failed attempt's listener is gone, and nothing was printed or stored.
    expect(await reachable(port)).toBe(false);
    expect(successor.lines.some((l) => l.startsWith('HTTP bearer token'))).toBe(false);
    const check = openStore(state.db);
    expect(check.getHttpTokenHash()).toBeUndefined();
    check.close();
    // The failure clears; the next attempt brings HTTP up with one working token.
    failCommit = false;
    timers.fire();
    await until(
      () => successor.lines.some((l) => l.startsWith('HTTP bearer token')),
      5000,
      'token line',
    );
    expect(successor.lines.filter((l) => l.startsWith('HTTP bearer token'))).toHaveLength(1);
    const tok =
      (successor.lines.find((l) => l.startsWith('HTTP bearer token')) ?? '').split(': ')[1] ?? '';
    expect(await status(port, tok)).toBe(200);
    expect(timers.pending).toBeUndefined();
  }, 40_000);

  it('stop() cancels the HTTP retry timer', async () => {
    const { timers, successor, blocker } = await blockedTakeover();
    expect(timers.pending).toBeDefined();
    await successor.app.stop();
    expect(timers.pending).toBeUndefined();
    expect(timers.cleared).toBeGreaterThan(0);
    await new Promise((r) => blocker.close(r));
  }, 40_000);

  it('stop() with a successful retry listen in flight leaves no server, token or timer', async () => {
    const { state, port, blocker, timers, successor } = await blockedTakeover();
    await new Promise((r) => blocker.close(r));
    const armed = timers.armed;
    timers.fire(); // the listen is now in flight
    await successor.app.stop();
    await new Promise((r) => setTimeout(r, 200));
    expect(await reachable(port)).toBe(false);
    expect(successor.lines.some((l) => l.startsWith('HTTP bearer token'))).toBe(false);
    expect(successor.lines.some((l) => l.startsWith('MCP HTTP at'))).toBe(false);
    expect(timers.pending).toBeUndefined();
    expect(timers.armed).toBe(armed);
    const check = openStore(state.db);
    expect(check.getHttpTokenHash()).toBeUndefined();
    check.close();
  }, 40_000);

  it('stop() with a failing retry listen in flight does not re-arm the timer', async () => {
    const { timers, successor, blocker } = await blockedTakeover();
    const armed = timers.armed;
    timers.fire(); // fails again: the port is still blocked
    await successor.app.stop();
    await new Promise((r) => setTimeout(r, 200));
    expect(timers.pending).toBeUndefined();
    expect(timers.armed).toBe(armed);
    expect(successor.lines.some((l) => l.startsWith('HTTP still off'))).toBe(false);
    await new Promise((r) => blocker.close(r));
  }, 40_000);

  it('logs a retry failure only when its reason changes', async () => {
    const { timers, successor, blocker } = await blockedTakeover();
    const count = () => successor.lines.filter((l) => l.startsWith('HTTP still off')).length;
    const armed = () => timers.armed;
    for (let i = 0; i < 2; i++) {
      const before = armed();
      timers.fire();
      await until(() => armed() > before, 5000, 're-armed');
    }
    expect(count()).toBe(0); // same EADDRINUSE reason as the first line
    await new Promise((r) => blocker.close(r));
  }, 40_000);

  it.each([
    ['behind', -1, /start the gateway once/],
    ['ahead', 99, /older than the database/],
  ])('--http-rotate-token refuses a db that is %s and leaves it alone', (_n, version, msg) => {
    const state = tempState();
    cleanups.push(state.cleanup);
    if (version < 0) {
      // A real version-8 db: everything but the last migration applied.
      const db = new DatabaseSync(state.db);
      applyMigrations(db, MIGRATIONS.slice(0, -1));
      db.close();
    } else {
      const db = new DatabaseSync(state.db);
      db.exec('CREATE TABLE marker (x)');
      db.exec(`PRAGMA user_version = ${version}`);
      db.close();
    }
    const r = spawnSync(process.execPath, [cli, '--http-rotate-token', '--db', state.db], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(msg);
    expect(r.stderr).toContain('old token is unchanged');
    const after = new DatabaseSync(state.db);
    expect(after.prepare('PRAGMA user_version').get()).toEqual({
      user_version: version < 0 ? MIGRATIONS.length - 1 : version,
    });
    expect(
      after.prepare("SELECT name FROM sqlite_master WHERE name = 'gateway_settings'").all(),
    ).toEqual([]);
    after.close();
  });

  it('--http-rotate-token refuses a missing db', () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const r = spawnSync(
      process.execPath,
      [cli, '--http-rotate-token', '--db', `${state.dir}/none.db`],
      {
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/start the gateway once/);
  });

  it('--http-rotate-token refuses :memory: with a non-zero exit', () => {
    const r = spawnSync(process.execPath, [cli, '--http-rotate-token', '--db', ':memory:'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(r.status).toBe(2);
  });
});

const cli = fileURLToPath(new URL('../../dist/bin/cli.js', import.meta.url));

/** Status of an authenticated MCP request: 401 for a bad token, anything else means it passed. */
async function status(port: number, tok: string): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${tok}`,
    },
    body: '{',
  });
  return res.status === 401 ? 401 : 200;
}
