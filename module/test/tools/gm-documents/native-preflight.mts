import { assertNativeBundleHash, nativeDestructivePolicy } from './native-plan.js';
/* eslint-disable @typescript-eslint/no-explicit-any */
/** Read-only native prerequisite check. Routes the explicitly pinned local bundle; no fixture/setting writes. */
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../../../../gateway/src/store/index.js';
import { readNativeWritePolicy } from '../player-writes/live-policy.js';
import { loadContext } from '../../../../e2e/lib/context.js';
import { openUserBrowser, joinWorld, asJoinPage } from '../../../../e2e/lib/browser.js';
import { readNativeReadiness } from '../player-tokens-combat/native-readiness.js';
const { config, paths } = loadContext();
const version = process.env.AGENT_GATEWAY_TASK23_GENERATION;
if (config.world !== 'test-world' || (version !== 'v13' && version !== 'v14'))
  throw Error('Choose the configured test-world generation');
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const bundle = readFileSync(resolve(root, 'dist/module/main.js'));
assertNativeBundleHash(
  createHash('sha256').update(bundle).digest('hex'),
  process.env.AGENT_GATEWAY_TASK23_EXPECTED_BUNDLE_SHA,
);
const browser = await openUserBrowser(config, paths, config.gmUser, { headed: false });
try {
  await browser.context.route('**/modules/agent-gateway/dist/module/main.js*', (route) =>
    route.fulfill({ body: bundle, contentType: 'text/javascript' }),
  );
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
  const rawPolicy = await browser.page.evaluate(() =>
    (globalThis as any).game.settings.get('agent-gateway', 'worldPolicy'),
  );
  const policy = readNativeWritePolicy(rawPolicy);
  if (nativeDestructivePolicy(rawPolicy) !== 'ask_owner')
    throw Error('GM destructive policy must require owner approval');
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
  const documents = await browser.page.evaluate(async () => {
    const { game, foundry } = globalThis as any;
    const actor = foundry.utils
      .getDocumentClass('Actor')
      .fromSource(
        { name: 'ag-task23-readonly-candidate', type: 'npc' },
        { strict: true, creation: true },
      );
    const journal = foundry.utils
      .getDocumentClass('JournalEntry')
      .fromSource({ name: 'ag-task23-readonly-candidate' }, { strict: true, creation: true });
    const data = [
      [
        'JournalEntryPage',
        {
          name: 'ag-task23-readonly-page',
          type: 'text',
          text: { format: 1, content: '<p>Read-only candidate</p>' },
        },
        journal,
      ],
      [
        'ActiveEffect',
        { name: 'ag-task23-readonly-effect', statuses: ['dead'], disabled: false },
        actor,
      ],
    ] as const;
    const embedded = data.map(([type, source, parent]) => {
      const candidate = foundry.utils
        .getDocumentClass(type)
        .fromSource(source, { parent, strict: true, creation: true });
      return {
        type,
        actualCreateAllowed: candidate.canUserModify(game.user, 'create', source),
        blankUiAllowed: foundry.utils.getDocumentClass(type).canUserCreate(game.user),
        name: candidate.name,
        activeEffectDeadGate:
          type === 'ActiveEffect' ? /dead/.test(candidate._preCreate.toString()) : null,
      };
    });
    const pack = game.packs.get('pf2e.equipment-srd');
    if (!pack || pack.documentName !== 'Item' || !pack.testUserPermission(game.user, 'OBSERVER'))
      throw Error('Expected visible PF2e Item source pack is unavailable');
    const index = await pack.getIndex();
    const chosen = index.find((entry: any) => entry.name === 'Dagger' && entry.type === 'weapon');
    if (!chosen) throw Error('Deterministic Dagger source is unavailable');
    const item = await pack.getDocument(chosen._id);
    const source = item.toObject();
    const bytes = new TextEncoder().encode(JSON.stringify(source)).length;
    const effects = item.effects?.size ?? 0;
    if (effects !== 0 || bytes > 65536 || item.flags?.['agent-gateway'])
      throw Error('Compendium source exceeds the bounded descendant-free plan');
    return {
      embedded,
      compendium: { uuid: item.uuid, name: item.name, type: item.type, effects, bytes },
      actorCandidateHasTokens: actor.getActiveTokens?.().length ?? 0,
      rootCreateAllowed: ['Actor', 'Item', 'JournalEntry'].every((name) =>
        foundry.utils.getDocumentClass(name).canUserCreate(game.user),
      ),
    };
  });
  if (!documents.embedded.every((row) => row.actualCreateAllowed) || !documents.rootCreateAllowed)
    throw Error('Native document permission prerequisite failed');
  console.log(
    JSON.stringify({
      target: config.foundryUrl,
      stateDir: paths.stateDir,
      ...facts,
      policy,
      documents,
      pairedIdentitiesMatch: true,
      dedicatedGmSessionRequiresHumanConfirmation: true,
    }),
  );
} finally {
  await browser.context.close();
}
