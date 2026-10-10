import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { asJoinPage, joinWorld, openUserBrowser } from '../lib/browser.js';
import { e2ePaths, loadE2eConfig, printWarnings } from '../lib/config.js';
import { ensureStateDirs } from '../lib/state.js';
import { FIXTURE_RUNTIME } from './runtime.js';
import {
  buildSeedPlan,
  FIXTURE_FLAG_KEY,
  FIXTURE_FLAG_SCOPE,
  E2E_RATE_LIMITS,
  PLAYER_AGENTS_SETTING,
  RATE_LIMITS_SETTING,
} from './spec.js';
import { formatCounts, verifyFixtureResult, type FixtureResult } from './verify.js';

function readState(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Run the seed or the clean as the GM in a persistent-profile browser. Writes to the world. */
export async function runFixtures(mode: 'seed' | 'clean'): Promise<void> {
  const paths = e2ePaths();
  const config = loadE2eConfig({
    testEnvText: existsSync(paths.testEnv) ? readFileSync(paths.testEnv, 'utf8') : undefined,
  });
  printWarnings(config);
  ensureStateDirs(paths, [config.gmUser]);
  const browser = await openUserBrowser(config, paths, config.gmUser, { headed: config.headed });
  try {
    await joinWorld(asJoinPage(browser.page), config, config.gmUser);
    const state = readState(paths.fixtureState);
    // The first seed's finding wins: a re-seed sees the value the last seed set.
    const restore =
      typeof state.previousPlayerAgentsEnabled === 'boolean'
        ? state.previousPlayerAgentsEnabled
        : undefined;
    const restoreLimits =
      typeof state.previousRateLimits === 'string' ? state.previousRateLimits : undefined;
    const arg = {
      mode,
      policySetting: PLAYER_AGENTS_SETTING,
      restorePlayerAgents: mode === 'clean' ? restore : undefined,
      rateLimitSetting: RATE_LIMITS_SETTING,
      e2eRateLimits: E2E_RATE_LIMITS,
      restoreRateLimits: mode === 'clean' ? restoreLimits : undefined,
      plan: buildSeedPlan({ gmUser: config.gmUser, playerUser: config.playerUser }),
      flagScope: FIXTURE_FLAG_SCOPE,
      flagKey: FIXTURE_FLAG_KEY,
    };
    const result = (await browser.page.evaluate(
      `(${FIXTURE_RUNTIME})(${JSON.stringify(arg)})`,
    )) as FixtureResult;
    process.stdout.write(`${formatCounts('before', result.before)}\n`);
    process.stdout.write(`${formatCounts('after', result.after)}\n`);
    if (mode === 'seed') {
      writeFileSync(
        paths.fixtureState,
        `${JSON.stringify({ ...result.totals, uuids: result.uuids, previousPlayerAgentsEnabled: restore ?? result.policy?.before, previousRateLimits: restoreLimits ?? result.rateLimits?.before })}\n`,
        { mode: 0o600 },
      );
    } else if (restore !== undefined || restoreLimits !== undefined) {
      // Restored: forget it, so a second clean does not overwrite a later change by the GM.
      const rest = { ...state };
      delete rest.previousPlayerAgentsEnabled;
      delete rest.previousRateLimits;
      writeFileSync(paths.fixtureState, `${JSON.stringify(rest)}\n`, { mode: 0o600 });
    }
    const problems = verifyFixtureResult(
      mode,
      result,
      mode === 'clean' ? restore : undefined,
      mode === 'clean' ? restoreLimits : undefined,
    );
    if (problems.length) throw new Error(`${mode} check failed:\n  ${problems.join('\n  ')}`);
    process.stdout.write(`${mode} ok\n`);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export function exitOnError(p: Promise<void>): void {
  p.catch((err: unknown) => {
    const e = err as Error;
    // A plain Error carries a user-facing hint; anything else (TypeError and the like) is a bug,
    // so print its stack.
    const text = e?.name && e.name !== 'Error' && e.stack ? e.stack : (e?.message ?? String(err));
    process.stderr.write(`${text}\n`);
    process.exit(1);
  });
}
