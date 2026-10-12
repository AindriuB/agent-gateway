/* eslint-disable @typescript-eslint/no-explicit-any */
/** Read-only discovery only. No routed bundle, fixture constructors, audio or notifications. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { loadContext } from '../../../../e2e/lib/context.js';
import { openUserBrowser, joinWorld, asJoinPage } from '../../../../e2e/lib/browser.js';
const generation = Number(process.env.AGENT_GATEWAY_TASK25_GENERATION);
if (![13, 14].includes(generation)) throw Error('Select v13 or v14 read-only discovery');
const { config, paths } = loadContext();
if (
  config.world !== 'test-world' ||
  new URL(config.foundryUrl).hostname !== (generation === 13 ? 'foundry13.local' : 'foundry.local')
)
  throw Error('Exact generation-specific test world required');
const browser = await openUserBrowser(config, paths, config.gmUser, { headed: false });
try {
  await joinWorld(asJoinPage(browser.page), config, config.gmUser, 30000);
  const facts = await browser.page.evaluate(
    async ({ generation, player, player2 }) => {
      const g = globalThis as any,
        game = g.game;
      if (
        !game.ready ||
        Number(game.release.generation) !== generation ||
        game.world.id !== 'test-world' ||
        !game.user.isGM ||
        game.users.get(game.user.id) !== game.user
      )
        throw Error('Native world/GM mismatch');
      const matches = [player, player2].map((name) =>
        game.users.filter((u: any) => u.name.toLowerCase() === name.toLowerCase()),
      );
      if (matches.some((rows) => rows.length !== 1 || rows[0].isGM))
        throw Error('Unique native player accounts required');
      const originalGM = game.user;
      const pack = game.packs.get('pf2e.equipment-srd');
      if (
        !pack ||
        pack.documentName !== 'Item' ||
        !pack.testUserPermission(game.user, 'OBSERVER') ||
        matches.some((rows) => !pack.testUserPermission(rows[0], 'OBSERVER'))
      )
        throw Error('Readonly Item reference pack unavailable');
      const index = await pack.getIndex();
      const entry = index.find((r: any) => r.name === 'Dagger' && r.type === 'weapon');
      if (!entry) throw Error('Deterministic public Item reference unavailable');
      const item = await pack.getDocument(entry._id);
      if (
        !item ||
        item.pack !== pack.collection ||
        item.documentName !== 'Item' ||
        g.foundry.utils.parseUuid(item.uuid)?.type !== 'Item'
      )
        throw Error('Canonical Item reference unavailable');
      const source = JSON.stringify(item.toObject());
      if (source.length > 65536) throw Error('Reference source exceeds proof bounds');
      const asset = 'sounds/lock.wav';
      const response = await fetch(new URL(asset, location.origin), { method: 'HEAD' });
      if (!response.ok) throw Error('Existing bundled audio asset unavailable');
      if (
        game.user !== originalGM ||
        game.users.get(originalGM.id) !== originalGM ||
        !originalGM.isGM ||
        game.world.id !== 'test-world' ||
        Number(game.release.generation) !== generation ||
        game.packs.get(pack.collection) !== pack ||
        matches.some(
          (rows) =>
            game.users.get(rows[0].id) !== rows[0] || !pack.testUserPermission(rows[0], 'OBSERVER'),
        )
      )
        throw Error('Native identity/reference permission changed during discovery');
      const users = matches.map((rows) => ({
        id: rows[0].id,
        name: rows[0].name,
        active: rows[0].active,
      }));
      return {
        version: game.version,
        world: game.world.id,
        system: game.system.id,
        gm: { id: game.user.id, name: game.user.name },
        players: users,
        activeGMs: game.users
          .filter((u: any) => u.active && u.isGM)
          .map((u: any) => ({ id: u.id, name: u.name })),
        asset: {
          path: asset,
          status: response.status,
          contentType: response.headers.get('content-type'),
        },
        reference: { uuid: item.uuid, name: item.name, source },
        playlists: game.playlists.contents.map((p: any) => ({
          uuid: p.uuid,
          source: p.toObject(),
        })),
        tables: game.tables.contents.map((t: any) => ({ uuid: t.uuid, source: t.toObject() })),
        worldTime: game.time.worldTime,
      };
    },
    { generation, player: config.playerUser, player2: config.player2User },
  );
  const dir = resolve('/private/tmp', `task25-readonly-v${generation}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'preflight.json'), JSON.stringify(facts, null, 2));
  console.log(
    JSON.stringify({
      generation,
      version: facts.version,
      world: facts.world,
      system: facts.system,
      soleGM: facts.activeGMs.length === 1 && facts.activeGMs[0].id === facts.gm.id,
      players: facts.players.map((p) => ({ name: p.name, active: p.active })),
      asset: facts.asset,
      referenceName: facts.reference.name,
      referenceSourceSHA256: createHash('sha256').update(facts.reference.source).digest('hex'),
      evidence: dir,
    }),
  );
} finally {
  await browser.close();
}
