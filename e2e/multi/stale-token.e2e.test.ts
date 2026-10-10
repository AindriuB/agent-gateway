import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { e2ePaths, profileDir } from '../lib/config.js';
import { loadContext } from '../lib/context.js';
import { openUserSession } from '../lib/session.js';
import { ensureStateDirs, preflightState, SETUP_HINT, tightenDb } from '../lib/state.js';
import { CONNECT_BUDGET_MS } from '../lib/wait.js';
import { MultiGateway } from './gateway.js';
import { recordResult, seconds } from './results.js';

const ctx = loadContext();
const { config } = ctx;
const user = config.playerUser;
const scratchRoot = mkdtempSync(join(tmpdir(), 'ag-e2e-stale-'));
// The scratch state dir: never the real one.
const scratch = e2ePaths(undefined, { AGENT_GATEWAY_E2E_STATE_DIR: join(scratchRoot, 'e2e') });

afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});

describe('stale token fails fast', () => {
  it('a pairing the module cannot use fails within 45 s with the setup hint', async () => {
    expect(scratch.stateDir.startsWith(ctx.paths.stateDir)).toBe(false);
    ensureStateDirs(scratch, [user]);
    // Let a gateway create the schema in the scratch DB, then replace its pairings with one
    // fabricated row whose token no browser holds.
    const gw = new MultiGateway(config, scratch, user);
    await gw.start();
    await gw.stop();
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
    // A copy of the real profile (its stored token is not in the scratch DB) when there is one;
    // otherwise the fresh empty profile that ensureStateDirs made. The real profile is only read.
    const real = profileDir(ctx.paths, user);
    const copied = existsSync(real);
    if (copied) {
      rmSync(profileDir(scratch, user), { recursive: true, force: true });
      mkdirSync(scratch.profilesDir, { recursive: true });
      cpSync(real, profileDir(scratch, user), {
        recursive: true,
        filter: (src) => !/\/Singleton(Lock|Cookie|Socket)$/.test(src),
      });
    }
    expect(preflightState({ paths: scratch, world: config.world, users: [user] })).toEqual([]);

    const start = Date.now();
    let message = '';
    try {
      const s = await openUserSession(config, scratch, user, {
        connectDeadlineAt: start + CONNECT_BUDGET_MS,
      });
      await s.close();
    } catch (err) {
      message = (err as Error).message;
    }
    const elapsed = Date.now() - start;
    recordResult(ctx.paths.stateDir, {
      suite: 'stale-token',
      label: `failure time (${copied ? 'copied profile' : 'fresh profile'}, fabricated pairing)`,
      value: seconds(elapsed),
    });
    expect(message, 'the open succeeded; the fabricated pairing was usable').not.toBe('');
    expect(message).toContain(SETUP_HINT);
    expect(elapsed).toBeLessThan(45_000);
  });
});
