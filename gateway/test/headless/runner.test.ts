import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
  closes = 0;
  async launch(req: { profileDir: string }): Promise<RunnerBrowser> {
    this.launches.push(req.profileDir);
    return {
      page: {
        goto: async (u) => void this.navigations.push(u),
        url: () => 'http://x/game',
        waitForSelector: async () => undefined,
        selectOption: async () => undefined,
        fill: async (_s: string, v: string) => void this.filled.push(v),
        click: async () => undefined,
        evaluate: async () => undefined,
        waitForGameReady: async () => undefined,
      },
      close: async () => void this.closes++,
    };
  }
}

async function make(over: { linked?: () => boolean; now?: () => number; stateDir?: string } = {}) {
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

  it('pauses after replaced and does not reload until 5 minutes pass', async () => {
    let clock = 0;
    let linked = true;
    const t = await make({ linked: () => linked, now: () => clock });
    t.runner.start();
    await t.runner.tick();
    linked = false;
    t.runner.replaced('Agent');
    expect(t.logs).toContain('agent user Agent was taken by another client; the runner is paused');
    await t.runner.tick();
    expect(t.launcher.launches).toHaveLength(1);
    expect(t.launcher.closes).toBe(0);
    clock += REPLACED_PAUSE_MS;
    await t.runner.tick();
    expect(t.launcher.closes).toBe(1);
    expect(t.launcher.launches).toHaveLength(2);
  });

  it('a world restart ends the pause', async () => {
    const clock = 0;
    let linked = true;
    const t = await make({ linked: () => linked, now: () => clock });
    t.runner.start();
    await t.runner.tick();
    linked = false;
    t.runner.replaced('Agent');
    t.foundry.active = false;
    await t.runner.tick();
    t.foundry.active = true;
    await t.runner.tick();
    expect(t.launcher.launches).toHaveLength(2);
  });
});
