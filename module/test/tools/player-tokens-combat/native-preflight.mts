/* eslint-disable @typescript-eslint/no-explicit-any */
/** Read-only native prerequisite check. Uses existing installed module; no fixture/setting writes. */
import { existsSync } from 'node:fs';
import { openStore } from '../../../../gateway/src/store/index.js';
import { readNativeWritePolicy } from '../player-writes/live-policy.js';
import { loadContext } from '../../../../e2e/lib/context.js';
import { openUserBrowser, joinWorld, asJoinPage } from '../../../../e2e/lib/browser.js';
import { readNativeReadiness } from './native-readiness.js';
const { config, paths } = loadContext();
const version = process.env.AGENT_GATEWAY_TASK22_GENERATION;
if (config.world !== 'test-world' || (version !== 'v13' && version !== 'v14'))
  throw Error('Choose the configured test-world generation');
const browser = await openUserBrowser(config, paths, config.gmUser, { headed: false });
try {
  await joinWorld(asJoinPage(browser.page), config, config.gmUser);
  const isolation = await browser.page.evaluate(
    ({ playerName }) => {
      const game = (globalThis as any).game;
      return {
        version: game.version,
        world: game.world.id,
        system: game.system.id,
        currentUser: { name: game.user.name, isGM: game.user.isGM },
        activeGM: game.users.activeGM?.name ?? null,
        activeGMs: game.users.filter((u: any) => u.active && u.isGM).map((u: any) => u.name),
        matchingPlayers: game.users
          .filter((u: any) => u.name.toLowerCase() === playerName.toLowerCase())
          .map((u: any) => ({ name: u.name, isGM: u.isGM })),
      };
    },
    { playerName: config.playerUser },
  );
  console.log(JSON.stringify({ target: config.foundryUrl, isolation }));
  const facts = await browser.page.evaluate(readNativeReadiness, {
    playerName: config.playerUser,
    version,
    reportOnly: true,
  });
  const policy = readNativeWritePolicy(
    await browser.page.evaluate(() =>
      (globalThis as any).game.settings.get('agent-gateway', 'worldPolicy'),
    ),
  );
  if (policy.gm !== 'ask_owner' || policy.player !== 'ask_owner')
    throw Error('Default owner-approval policy prerequisite failed');
  if (!existsSync(paths.db)) throw Error('Existing paired gateway state is missing');
  const store = openStore(paths.db);
  try {
    const pairings = store.listActivePairings();
    for (const user of [facts.gm, facts.player])
      if (pairings.filter((p) => p.worldId === config.world && p.userId === user.id).length !== 1)
        throw Error('Exact native user has no unique stored active pairing');
  } finally {
    store.close();
  }
  console.log(
    JSON.stringify({
      target: config.foundryUrl,
      stateDir: paths.stateDir,
      ...facts,
      policy,
      pairedIdentitiesMatch: true,
      dedicatedGmSessionRequiresHumanConfirmation: true,
    }),
  );
} finally {
  await browser.context.close();
}
