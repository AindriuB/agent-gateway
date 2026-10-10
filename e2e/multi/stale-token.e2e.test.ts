import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { asJoinPage, joinWorld, openUserBrowser, type UserBrowser } from '../lib/browser.js';
import { e2ePaths, profileDir } from '../lib/config.js';
import { loadContext } from '../lib/context.js';
import { GatewayProcess, NotConnectedError, waitConnected } from '../lib/gateway.js';
import { ensureStateDirs, preflightState, SETUP_HINT, tightenDb } from '../lib/state.js';
import { CONNECT_BUDGET_MS } from '../lib/wait.js';
import { FrameCounter, waitFor } from './frames.js';
import { recordResult, seconds } from './results.js';

const ctx = loadContext();
const { config } = ctx;
const user = config.playerUser;
const realProfile = profileDir(ctx.paths, user);
const haveProfile = existsSync(realProfile);
if (!haveProfile) {
  process.stdout.write(
    `SKIP: no stored ${user} profile to copy (${realProfile}); run npm run test:e2e:setup\n`,
  );
}
const scratchRoot = mkdtempSync(join(tmpdir(), 'ag-e2e-stale-'));
// The scratch state dir: never the real one.
const scratch = e2ePaths(undefined, { AGENT_GATEWAY_E2E_STATE_DIR: join(scratchRoot, 'e2e') });

afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});

describe.skipIf(!haveProfile)('stale token fails fast', () => {
  it('a token the gateway does not know is rejected, and the run fails within 45 s with the hint', async () => {
    expect(scratch.stateDir.startsWith(ctx.paths.stateDir)).toBe(false);
    ensureStateDirs(scratch, [user]);
    // Let a gateway create the schema in the scratch DB, then leave one fabricated pairing whose
    // token no browser holds.
    const seed = new GatewayProcess(config, scratch, user);
    await seed.start();
    await seed.stop();
    tightenDb(scratch);
    const db = new DatabaseSync(scratch.db);
    try {
      db.prepare('DELETE FROM pairings').run();
      db.prepare(
        'INSERT INTO pairings (id, token_hash, world_id, user_id, created_at, user_name) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('stale-e2e', 'f'.repeat(64), config.world, 'stale-user-id', Date.now(), user);
    } finally {
      db.close();
    }
    // A copy of the real profile, whose stored token is not in the scratch DB. Only read.
    rmSync(profileDir(scratch, user), { recursive: true, force: true });
    mkdirSync(scratch.profilesDir, { recursive: true });
    cpSync(realProfile, profileDir(scratch, user), {
      recursive: true,
      filter: (src) => !/\/Singleton(Lock|Cookie|Socket)$/.test(src),
    });
    expect(preflightState({ paths: scratch, world: config.world, users: [user] })).toEqual([]);

    // The clock covers the whole open: gateway start, browser launch, join, rejection, error.
    const start = Date.now();
    const gateway = new GatewayProcess(config, scratch, user);
    const frames = new FrameCounter(config.linkPort);
    let browser: UserBrowser | undefined;
    let error: unknown;
    try {
      await gateway.start();
      browser = await openUserBrowser(config, scratch, user, { headed: config.headed });
      frames.attach(browser.page);
      await joinWorld(
        asJoinPage(browser.page),
        config,
        user,
        Math.max(1, start + CONNECT_BUDGET_MS - Date.now()),
      );
      await waitFor(
        () => frames.rejectCodes.length > 0,
        Math.max(1, start + CONNECT_BUDGET_MS - Date.now()),
        100,
      );
      // The harness's own connection wait, one probe, as the run would report it.
      await waitConnected(gateway, 1000);
    } catch (err) {
      error = err;
    } finally {
      await browser?.close().catch(() => undefined);
      await gateway.stop();
    }
    const elapsed = Date.now() - start;
    recordResult(ctx.paths.stateDir, {
      suite: 'stale-token',
      label: 'failure time (copied profile, fabricated pairing)',
      value: seconds(elapsed),
    });
    expect(frames.rejectCodes, 'the gateway did not reject the stored token').toContain(
      'PAIRING_INVALID',
    );
    expect(error, 'expected the connection wait to fail').toBeInstanceOf(NotConnectedError);
    expect((error as Error).message).toContain(SETUP_HINT);
    expect(elapsed).toBeLessThanOrEqual(45_000);
  }, 120_000);
});
