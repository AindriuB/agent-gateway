/**
 * `npm run test:e2e [-- --foundry v13|v14] [vitest args]`. Unattended: checks local state,
 * confirms every required user reconnects and the fixtures exist, then runs the live suites and
 * writes the summary. Fails fast with a message instead of waiting for input.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ArgError, parseRunArgs } from './lib/args.js';
import {
  ConfigError,
  e2ePaths,
  loadE2eConfig,
  printWarnings,
  type E2eConfig,
  type E2ePaths,
} from './lib/config.js';
import { GATEWAY_CLI, NotConnectedError, REPO_ROOT } from './lib/gateway.js';
import { readRunData, recordRunData, resetRunData } from './lib/rundata.js';
import { CONNECT_BUDGET_MS } from './lib/wait.js';
import { openUserSession } from './lib/session.js';
import { preflightMessage, preflightState, SEED_HINT, SETUP_HINT } from './lib/state.js';
import {
  buildSummary,
  formatSummary,
  totalFailures,
  writeSummary,
  type VitestJson,
} from './lib/summary.js';
import { chooseTarget } from './lib/target.js';
import { COMPENDIUM } from './lib/expect.js';
import { FIXTURE } from './fixtures/spec.js';

class PreflightError extends Error {}

async function livePreflight(
  config: E2eConfig,
  paths: E2ePaths,
  connectDeadlineAt: number,
): Promise<string> {
  let version = 'unknown';
  const gm = await openUserSession(config, paths, config.gmUser, { connectDeadlineAt });
  try {
    version = gm.foundryVersion;
    const found = await gm.gateway.call('document_search', {
      type: 'JournalEntry',
      query: FIXTURE.names.publicEntry,
    });
    const names = ((found.structured?.results ?? []) as Array<{ name: string }>).map((r) => r.name);
    if (!names.includes(FIXTURE.names.publicEntry)) {
      throw new PreflightError(`fixtures not found (${FIXTURE.names.publicEntry}); ${SEED_HINT}`);
    }
    const pack = await gm.gateway.call('compendium_search', {
      query: 'a',
      pack: COMPENDIUM.limitedPack,
      limit: 1,
    });
    const first = (pack.structured?.results as Array<{ uuid: string }> | undefined)?.[0]?.uuid;
    if (!first) {
      throw new PreflightError(
        `the GM found no entry in ${COMPENDIUM.limitedPack}; is the pf2e pack installed?`,
      );
    }
    recordRunData(paths.runData, { kind: 'facts', limitedPackUuid: first });
  } finally {
    await gm.close();
  }
  const player = await openUserSession(config, paths, config.playerUser, { connectDeadlineAt });
  await player.close();
  return version;
}

function runVitest(
  config: E2eConfig,
  paths: E2ePaths,
  rest: string[],
  reportPath: string,
): Promise<number> {
  const require = createRequire(import.meta.url);
  const vitestBin = join(require.resolve('vitest/package.json'), '..', 'vitest.mjs');
  const child = spawn(
    process.execPath,
    [
      '--max-old-space-size=2048',
      vitestBin,
      'run',
      '--config',
      join(REPO_ROOT, 'e2e', 'vitest.e2e.config.ts'),
      '--project',
      'e2e-live',
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${reportPath}`,
      ...rest,
    ],
    { stdio: 'inherit', cwd: REPO_ROOT, env: { ...process.env, FOUNDRY_URL: config.foundryUrl } },
  );
  return new Promise((resolve) => {
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

async function main(): Promise<number> {
  const startedAt = Date.now();
  const args = parseRunArgs(process.argv.slice(2));
  const paths = e2ePaths();
  const base = loadE2eConfig({
    testEnvText: existsSync(paths.testEnv) ? readFileSync(paths.testEnv, 'utf8') : undefined,
  });
  printWarnings(base);
  const target = chooseTarget(args.foundry, base);
  if (target.kind === 'skip') {
    process.stdout.write(`${target.message}\n`);
    return 0;
  }
  const { config } = target;

  const problems = preflightState({
    paths,
    world: config.world,
    users: [config.gmUser, config.playerUser],
  });
  if (problems.length) throw new PreflightError(preflightMessage(problems));
  if (!existsSync(GATEWAY_CLI)) throw new PreflightError('gateway is not built; run npm run build');

  resetRunData(paths.runData);
  const version = await livePreflight(config, paths, startedAt + CONNECT_BUDGET_MS);
  recordRunData(paths.runData, { kind: 'foundry', version });

  const reportPath = join(paths.stateDir, 'vitest-report.json');
  const code = await runVitest(config, paths, args.rest, reportPath);
  if (!existsSync(reportPath)) {
    process.stderr.write('vitest wrote no report\n');
    return code || 1;
  }
  const summary = buildSummary({
    foundryUrl: config.foundryUrl,
    foundryTarget: args.foundry,
    vitest: JSON.parse(readFileSync(reportPath, 'utf8')) as VitestJson,
    records: readRunData(paths.runData),
  });
  writeSummary(paths.summary, summary);
  process.stdout.write(`\n${formatSummary(summary)}\nsummary: ${paths.summary}\n`);
  return code !== 0 || totalFailures(summary) > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    const known =
      err instanceof PreflightError || err instanceof ConfigError || err instanceof ArgError;
    // A failure that reached here without the setup hint is still an operator-facing failure.
    const hint =
      err instanceof NotConnectedError || known || msg.includes(SETUP_HINT)
        ? ''
        : `\n${SETUP_HINT}`;
    process.stderr.write(`${msg}${hint}\n`);
    process.exit(1);
  },
);
