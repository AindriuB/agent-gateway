/* eslint-disable @typescript-eslint/no-explicit-any */
/** Read-only target preparation. No tool calls, document writes, pairing or fixture seeding. */
import { loadContext } from '../../../../e2e/lib/context.js';
import { openUserBrowser, joinWorld, asJoinPage } from '../../../../e2e/lib/browser.js';

const { config, paths } = loadContext();
const browser = await openUserBrowser(config, paths, config.gmUser, { headed: false });
try {
  await joinWorld(asJoinPage(browser.page), config, config.gmUser);
  const facts = await browser.page.evaluate(
    async ({ playerName, gmName }) => {
      const game = (globalThis as any).game;
      const player = game.users.find(
        (u: any) => u.name === playerName || u.name.toLowerCase() === playerName.toLowerCase(),
      );
      const gm = game.users.find(
        (u: any) => u.name === gmName || u.name.toLowerCase() === gmName.toLowerCase(),
      );
      const journals = game.journal.filter(
        (j: any) => j.flags?.['agent-gateway']?.fixture === true || /^ag-test-/.test(j.name),
      );
      return {
        url: location.origin,
        proposedJournalUuid: `JournalEntry.ag21v${String(game.version).split('.')[0]}writes001`,
        proposedJournalCollision: game.journal.has(
          `ag21v${String(game.version).split('.')[0]}writes001`,
        ),
        world: game.world.id,
        version: game.version,
        moduleVersion: game.modules.get('agent-gateway')?.version,
        loadedDocumentTypes: game.modules.get('agent-gateway')?.documentTypes,
        allowedJournalPageTypes: game.documentTypes.JournalEntryPage,
        servedManifestDocumentTypes: (
          await (await fetch('modules/agent-gateway/module.json')).json()
        ).documentTypes,
        users: [gm, player].map((u: any) => ({ id: u?.id, name: u?.name, isGM: u?.isGM })),
        journals: journals.map((j: any) => ({
          uuid: j.uuid,
          name: j.name,
          gmOwner: j.testUserPermission(gm, 'OWNER'),
          playerOwner: j.testUserPermission(player, 'OWNER'),
          pages: j.pages.map((p: any) => ({
            uuid: p.uuid,
            name: p.name,
            type: p.type,
            format: p.text?.format,
            playerOwner: p.testUserPermission(player, 'OWNER'),
          })),
        })),
        actors: game.actors
          .filter((a: any) => /^ag-test-/.test(a.name))
          .map((a: any) => ({
            uuid: a.uuid,
            name: a.name,
            playerOwner: a.testUserPermission(player, 'OWNER'),
          })),
      };
    },
    { playerName: config.playerUser, gmName: config.gmUser },
  );
  console.log(JSON.stringify(facts));
} finally {
  await browser.close();
}
