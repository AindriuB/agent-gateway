/**
 * One-time pairing. For each user: start a gateway, show its pairing code in a labelled headed
 * window, and wait for a human to type it. This script never types the code itself.
 */
import { existsSync, readFileSync } from 'node:fs';
import { ArgError, parseSetupArgs } from '../lib/args.js';
import {
  bannerScript,
  FOCUS_CODE_SCRIPT,
  joinWorld,
  openUserBrowser,
  OPEN_PAIRING_SCRIPT,
  setGatewayUrlScript,
} from '../lib/browser.js';
import {
  ConfigError,
  e2ePaths,
  loadE2eConfig,
  type E2eConfig,
  type E2ePaths,
} from '../lib/config.js';
import { GatewayProcess } from '../lib/gateway.js';
import { ensureStateDirs, tightenDb } from '../lib/state.js';
import { waitForPairing } from '../lib/wait.js';

async function pairUser(config: E2eConfig, paths: E2ePaths, user: string): Promise<void> {
  const gateway = new GatewayProcess(config, paths, user);
  let browser: Awaited<ReturnType<typeof openUserBrowser>> | undefined;
  try {
    await gateway.start();
    tightenDb(paths);
    const code = await gateway.pairingCode();
    browser = await openUserBrowser(config, paths, user, { headed: true });
    const { page } = browser;
    await joinWorld(page, config, user);
    await page.evaluate(setGatewayUrlScript(`ws://localhost:${config.linkPort}`));
    await page.evaluate(OPEN_PAIRING_SCRIPT);
    process.stdout.write(
      `Waiting for a human to enter the code for ${user} (see the browser window).\n`,
    );
    await waitForPairing(user, {
      timeoutMs: config.pairTimeoutMs,
      probe: async () => {
        // The banner is re-applied: Foundry re-renders and may reset the title.
        await page.evaluate(bannerScript(user, code)).catch(() => undefined);
        await page.evaluate(FOCUS_CODE_SCRIPT).catch(() => undefined);
        const r = await gateway.call('world_info');
        return !r.isError && r.structured?.userName === user;
      },
    });
    process.stdout.write(`paired ${user}\n`);
  } finally {
    await browser?.close().catch(() => undefined);
    await gateway.stop();
  }
}

async function main(): Promise<void> {
  const args = parseSetupArgs(process.argv.slice(2));
  const paths = e2ePaths();
  const config = loadE2eConfig({
    testEnvText: existsSync(paths.testEnv) ? readFileSync(paths.testEnv, 'utf8') : undefined,
  });
  let users = [config.gmUser, config.playerUser];
  if (args.includePlayer2) users.push(config.player2User);
  if (args.only.length) users = users.filter((u) => args.only.includes(u));
  ensureStateDirs(paths, users);
  for (const user of users) await pairUser(config, paths, user);
  process.stdout.write(`all paired: ${users.join(', ')}\n`);
}

main().catch((err: unknown) => {
  const known = err instanceof ConfigError || err instanceof ArgError;
  process.stderr.write(`${known || err instanceof Error ? (err as Error).message : String(err)}\n`);
  process.exit(1);
});
