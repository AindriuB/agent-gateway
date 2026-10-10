import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { joinWorld, openUserBrowser } from '../lib/browser.js';
import { e2ePaths, loadE2eConfig } from '../lib/config.js';
import { ensureStateDirs } from '../lib/state.js';
import { FIXTURE_RUNTIME } from './runtime.js';
import { buildSeedPlan, FIXTURE_FLAG_KEY, FIXTURE_FLAG_SCOPE } from './spec.js';
import { formatCounts, verifyFixtureResult, type FixtureResult } from './verify.js';

/** Run the seed or the clean as the GM in a persistent-profile browser. Writes to the world. */
export async function runFixtures(mode: 'seed' | 'clean'): Promise<void> {
  const paths = e2ePaths();
  const config = loadE2eConfig({
    testEnvText: existsSync(paths.testEnv) ? readFileSync(paths.testEnv, 'utf8') : undefined,
  });
  ensureStateDirs(paths, [config.gmUser]);
  const browser = await openUserBrowser(config, paths, config.gmUser, { headed: config.headed });
  try {
    await joinWorld(browser.page, config, config.gmUser);
    const arg = {
      mode,
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
        `${JSON.stringify({ ...result.totals, uuids: result.uuids })}\n`,
        { mode: 0o600 },
      );
    }
    const problems = verifyFixtureResult(mode, result);
    if (problems.length) throw new Error(`${mode} check failed:\n  ${problems.join('\n  ')}`);
    process.stdout.write(`${mode} ok\n`);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export function exitOnError(p: Promise<void>): void {
  p.catch((err: unknown) => {
    process.stderr.write(`${(err as Error).message ?? String(err)}\n`);
    process.exit(1);
  });
}
