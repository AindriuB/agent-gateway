/**
 * `npm run test:e2e [-- --foundry v13|v14] [vitest args]`. Unattended: checks local state,
 * confirms every required user reconnects and the fixtures exist, then runs the live suites and
 * writes the summary. Fails fast with a message instead of waiting for input.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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
import { openUserSession, type UserSession } from './lib/session.js';
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

export const SKIP_FIXTURES_ENV = 'AGENT_GATEWAY_E2E_SKIP_FIXTURES';
export const FIXTURES_SKIPPED_LINE =
  `fixtures skipped (${SKIP_FIXTURES_ENV}=1): the seeded-fixture and limited-pack checks did not run; ` +
  'only suites that do not use the fixtures may be run';

/**
 * Opt-in `AGENT_GATEWAY_E2E_SKIP_FIXTURES=1` skips only the fixture and limited-pack preflight
 * checks (the connection and Foundry version are still checked). It needs a vitest file filter,
 * so the fixture suites (which also fail by themselves when the fixture state or the recorded
 * limited-pack entry is missing) are never run wholesale without their preflight.
 */
export function fixturePolicy(
  env: Readonly<Record<string, string | undefined>>,
  rest: readonly string[],
): { skip: boolean } {
  if (env[SKIP_FIXTURES_ENV] !== '1') return { skip: false };
  if (!rest.some((a) => !a.startsWith('-')))
    throw new PreflightError(
      `${SKIP_FIXTURES_ENV}=1 needs a suite filter, for example: npm run test:e2e -- --foundry v14 dnd5e`,
    );
  return { skip: true };
}

/** What livePreflight needs from a session, so the order of opens and closes can be tested. */
export interface PreflightSession {
  foundryVersion: string;
  gateway: Pick<UserSession['gateway'], 'call'>;
  close(): Promise<void>;
}
export type OpenPreflightSession = (user: string) => Promise<PreflightSession>;

/**
 * The GM session is always closed before the player session opens: both gateways bind the same
 * link port, so the second cannot start while the first is still up. Skipping the fixtures skips
 * only the two fixture checks; the close and the player check are the same path.
 */
export async function livePreflight(
  config: Pick<E2eConfig, 'gmUser' | 'playerUser'>,
  paths: Pick<E2ePaths, 'runData'>,
  open: OpenPreflightSession,
  skipFixtures = false,
): Promise<string> {
  let version = 'unknown';
  const gm = await open(config.gmUser);
  try {
    version = gm.foundryVersion;
    if (skipFixtures) process.stdout.write(`${FIXTURES_SKIPPED_LINE}\n`);
    else {
      const found = await gm.gateway.call('document_search', {
        type: 'JournalEntry',
        query: FIXTURE.names.publicEntry,
      });
      const names = ((found.structured?.results ?? []) as Array<{ name: string }>).map(
        (r) => r.name,
      );
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
    }
  } finally {
    await gm.close();
  }
  const player = await open(config.playerUser);
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
  const policy = fixturePolicy(process.env, args.rest);
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
  const version = await livePreflight(
    config,
    paths,
    (user) =>
      openUserSession(config, paths, user, { connectDeadlineAt: startedAt + CONNECT_BUDGET_MS }),
    policy.skip,
  );
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

// Only run as the entry point, so the helpers above can be imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
}
