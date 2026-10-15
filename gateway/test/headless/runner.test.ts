import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HEADLESS_LINK_KEY } from '../../src/headless/flag.js';
import { HeadlessInvites } from '../../src/headless/invites.js';
import { profileDir } from '../../src/headless/profile.js';
import {
  HeadlessRunner,
  REPLACED_PAUSE_MS,
  RUNNER_PATHS,
  STATUS_POLL_MS,
  type BrowserLauncher,
  type RunnerBrowser,
} from '../../src/headless/runner.js';

const W = 'test-world';
const U = 'agentuser0000001';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'ag-run-'));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
};

/** A stub Foundry: `/api/status` answers whatever the test says; every request is recorded. */
async function stubFoundry() {
  const s = { active: true, fail: false, requests: [] as string[] };
  const server: Server = createServer((req, res) => {
    s.requests.push(req.url ?? '');
    if (s.fail) return void res.writeHead(500).end();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ active: s.active, world: s.active ? W : null }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
  const port = (server.address() as { port: number }).port;
  return Object.assign(s, { url: `http://127.0.0.1:${port}` });
}

class Launcher implements BrowserLauncher {
  launches: string[] = [];
  navigations: string[] = [];
  filled: string[] = [];
  args: string[][] = [];
  /** What the page's module mirrors into session storage. */
  linkState: string | null = null;
  closes = 0;
  launchError: Error | undefined;
  async launch(req: { profileDir: string; args: string[] }): Promise<RunnerBrowser> {
    if (this.launchError) throw this.launchError;
    this.launches.push(req.profileDir);
    this.args.push(req.args);
    return {
      page: {
        goto: async (u) => void this.navigations.push(u),
        url: () => 'http://x/game',
        waitForSelector: async () => undefined,
        selectOption: async () => undefined,
        fill: async (_s: string, v: string) => void this.filled.push(v),
        click: async () => undefined,
        evaluate: async (script: string) =>
          script.includes(HEADLESS_LINK_KEY) ? this.linkState : undefined,
        waitForGameReady: async () => undefined,
      },
      close: async () => void this.closes++,
    };
  }
}

async function make(
  over: {
    linked?: () => boolean;
    now?: () => number;
    stateDir?: string;
    fetch?: typeof fetch;
    noSandbox?: boolean;
  } = {},
) {
  const foundry = await stubFoundry();
  const stateDir = over.stateDir ?? tmp();
  const launcher = new Launcher();
  const logs: string[] = [];
  const invites = new HeadlessInvites({ isAgentActive: () => true });
  const runner = new HeadlessRunner({
    agent: { foundryUrl: foundry.url, worldId: W, userId: U, password: 'pw' },
    stateDir,
    gatewayLinkUrl: 'ws://localhost:1',
    invites,
    launcher,
    isLinked: over.linked ?? (() => true),
    log: (l) => void logs.push(l),
    ...(over.now ? { now: over.now } : {}),
    ...(over.fetch ? { fetch: over.fetch } : {}),
    ...(over.noSandbox !== undefined ? { noSandbox: over.noSandbox } : {}),
    sleep: async () => undefined,
    linkGraceMs: 1,
    pairWaitMs: 1,
  });
  cleanups.push(() => runner.stop());
  return { foundry, stateDir, launcher, logs, runner, invites };
}

describe('HeadlessRunner invites', () => {
  it('mints a fresh invite on the next attempt after one expired unused', async () => {
    const t = await make({ linked: () => false });
    t.runner.start();
    await t.runner.tick();
    await t.runner.tick();
    const codes = t.launcher.filled.filter((v) => /^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/.test(v));
    expect(codes).toHaveLength(2);
    expect(codes[0]).not.toBe(codes[1]);
    expect(t.logs.filter((l) => l.includes('(redacted)'))).toHaveLength(2);
    expect(t.logs.join('\n')).not.toContain(codes[0]!);
    expect(t.invites.size).toBe(1);
  });

  it('mints nothing when the stored token connects', async () => {
    const t = await make({ linked: () => true });
    t.runner.start();
    await t.runner.tick();
    expect(t.launcher.filled).toEqual([]);
    expect(t.invites.size).toBe(0);
  });
});

describe('HeadlessRunner lifecycle', () => {
  it('polls every 15 s', () => {
    expect(STATUS_POLL_MS).toBe(15_000);
  });

  it('opens the browser when the world is active and closes it when it goes down', async () => {
    const t = await make();
    expect(t.runner.start()).toBe(true);
    await t.runner.tick();
    expect(t.launcher.launches).toEqual([profileDir(t.stateDir, W, U)]);
    expect(t.launcher.navigations).toEqual([`${t.foundry.url}/join`]);
    t.foundry.active = false;
    await t.runner.tick();
    expect(t.launcher.closes).toBe(1);
    // The world starts again: a new browser.
    t.foundry.active = true;
    await t.runner.tick();
    expect(t.launcher.launches).toHaveLength(2);
  });

  it('closes the browser after three failed polls in a row, not before', async () => {
    const t = await make();
    t.runner.start();
    await t.runner.tick();
    t.foundry.fail = true;
    await t.runner.tick();
    await t.runner.tick();
    expect(t.launcher.closes).toBe(0);
    t.foundry.fail = false;
    await t.runner.tick();
    t.foundry.fail = true;
    await t.runner.tick();
    await t.runner.tick();
    expect(t.launcher.closes).toBe(0);
    await t.runner.tick();
    expect(t.launcher.closes).toBe(1);
  });

  it('logs the first status failure once, and once again on recovery', async () => {
    const t = await make();
    t.runner.start();
    await t.runner.tick();
    t.foundry.fail = true;
    for (let i = 0; i < 4; i++) await t.runner.tick();
    expect(t.logs.filter((l) => l.includes('cannot read'))).toHaveLength(1);
    t.foundry.fail = false;
    await t.runner.tick();
    await t.runner.tick();
    expect(t.logs.filter((l) => l.includes('readable again'))).toHaveLength(1);
  });

  it('logs playwright-core-not-installed once across polls', async () => {
    const t = await make();
    t.launcher.launchError = new Error('playwright-core is not installed; use npm');
    t.runner.start();
    await t.runner.tick();
    await t.runner.tick();
    expect(t.logs.filter((l) => l.includes('playwright-core is not installed'))).toHaveLength(1);
  });

  it('logs a thrown fetch (TLS, refused) with its cause, once', async () => {
    const bad = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'CERT_HAS_EXPIRED' } });
    }) as unknown as typeof fetch;
    const t = await make({ fetch: bad });
    t.runner.start();
    await t.runner.tick();
    await t.runner.tick();
    const l = t.logs.filter((x) => x.includes('cannot read'));
    expect(l).toHaveLength(1);
    expect(l[0]).toContain('CERT_HAS_EXPIRED');
  });

  it('requests and navigates to only /api/status, /join and /game', async () => {
    const t = await make();
    t.runner.start();
    await t.runner.tick();
    t.foundry.active = false;
    await t.runner.tick();
    const paths = [
      ...t.foundry.requests,
      ...t.launcher.navigations.map((u) => new URL(u).pathname),
    ].map((p) => p.split('?')[0]);
    expect(paths.length).toBeGreaterThan(2);
    for (const p of paths) expect(RUNNER_PATHS as readonly string[]).toContain(p);
    expect(paths.some((p) => /setup|admin/.test(p!))).toBe(false);
  });

  it('stop() closes the browser well within 5 s and leaves the profile', async () => {
    const t = await make();
    t.runner.start();
    await t.runner.tick();
    const started = Date.now();
    await t.runner.stop();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(t.launcher.closes).toBe(1);
    await t.runner.tick();
    expect(t.launcher.launches).toHaveLength(1);
  });

  it('refuses to start when profiles/ is a symlink', async () => {
    const stateDir = tmp();
    mkdirSync(join(stateDir, 'headless'));
    symlinkSync(tmp(), join(stateDir, 'headless', 'profiles'));
    const t = await make({ stateDir });
    expect(t.runner.start()).toBe(false);
    expect(t.logs.join('\n')).toContain('symlink');
    await t.runner.tick();
    expect(t.launcher.launches).toHaveLength(0);
  });

  it('pauses when its own page reports REPLACED, logs once, and resumes after 5 minutes', async () => {
    let clock = 0;
    let linked = true;
    const t = await make({ linked: () => linked, now: () => clock });
    t.runner.start();
    await t.runner.tick();
    linked = false;
    t.launcher.linkState = 'replaced';
    await t.runner.tick();
    const line = `agent user ${U} was taken by another client; the runner is paused`;
    expect(t.logs).toContain(line);
    await t.runner.tick();
    expect(t.launcher.launches).toHaveLength(1);
    expect(t.launcher.closes).toBe(0);
    expect(t.logs.filter((l) => l === line)).toHaveLength(1);
    clock += REPLACED_PAUSE_MS;
    t.launcher.linkState = null;
    await t.runner.tick();
    expect(t.launcher.closes).toBe(1);
    expect(t.launcher.launches).toHaveLength(2);
  });

  it('neither logs nor pauses when it replaced another client (its page is connected)', async () => {
    let linked = false;
    const t = await make({ linked: () => linked });
    t.launcher.linkState = 'connected';
    t.runner.start();
    await t.runner.tick();
    await t.runner.tick();
    expect(t.logs.join('\n')).not.toContain('taken by another client');
    expect(t.launcher.closes).toBe(0);
    expect(t.launcher.launches).toHaveLength(1);
    linked = true;
    await t.runner.tick();
    expect(t.logs.join('\n')).not.toContain('taken by another client');
  });

  it('a world restart ends the pause', async () => {
    const clock = 0;
    const t = await make({ linked: () => false, now: () => clock });
    t.runner.start();
    await t.runner.tick();
    t.launcher.linkState = 'replaced';
    await t.runner.tick();
    t.launcher.linkState = null;
    t.foundry.active = false;
    await t.runner.tick();
    t.foundry.active = true;
    await t.runner.tick();
    expect(t.launcher.launches).toHaveLength(2);
    const codes = () => t.launcher.filled.filter((v) => /^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/.test(v));
    expect(codes()).toHaveLength(2);
  });

  it('stop() returns within 5 s while a status fetch never settles', async () => {
    const hung = ((_url: string, init?: RequestInit) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
      })) as unknown as typeof fetch;
    const t = await make({ fetch: hung });
    t.runner.start();
    const started = Date.now();
    await t.runner.stop();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('passes --no-sandbox to the launcher only when configured', async () => {
    const off = await make();
    off.runner.start();
    await off.runner.tick();
    expect(off.launcher.args[0]).toEqual([]);
    const on = await make({ noSandbox: true });
    on.runner.start();
    await on.runner.tick();
    expect(on.launcher.args[0]).toEqual(['--no-sandbox']);
  });

  it('logs a fixed message, not Playwright text, when typing the invite code fails', async () => {
    const t = await make({ linked: () => false });
    const orig = t.launcher.launch.bind(t.launcher);
    t.launcher.launch = async (req) => {
      const b = await orig(req);
      b.page.fill = async (_s: string, v: string) => {
        if (v.startsWith('ws://')) return;
        throw new Error(`locator.fill("${v}") timed out`);
      };
      return b;
    };
    t.runner.start();
    await t.runner.tick();
    const log = t.logs.join('\n');
    expect(log).toContain('could not type the invite code');
    expect(log).not.toMatch(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/);
  });
});
