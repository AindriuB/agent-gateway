/* eslint-disable @typescript-eslint/no-explicit-any */
/** Native task22 acceptance. Explicit fixture approval required; never clicks approval controls. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadContext } from '../../../../e2e/lib/context.js';
import { openUserBrowser, joinWorld, asJoinPage } from '../../../../e2e/lib/browser.js';
import { LinkRegistry, LinkServer, PairingCodes } from '../../../../gateway/src/link/index.js';
import { createSessionServer } from '../../../../gateway/src/mcp/session.js';
import { openStore } from '../../../../gateway/src/store/index.js';
import {
  startLiveBatch,
  waitForLiveAudit,
  readNativeAuditRows,
  liveAuditKey,
} from '../player-writes/live-settlement.js';
import { readNativeWritePolicy } from '../player-writes/live-policy.js';
import { readNativeReadiness } from './native-readiness.js';
import { waitForNativeApprovals } from './native-approval.js';
import { cleanupNativeFixtures, retainNativeAudit } from './native-lifecycle.js';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const { config, paths } = loadContext();
const version = process.env.AGENT_GATEWAY_TASK22_GENERATION;
if (config.world !== 'test-world' || (version !== 'v13' && version !== 'v14'))
  throw Error('Select a prepared test-world generation');
const approved = process.env.AGENT_GATEWAY_TASK22_APPROVED === 'exact-fixtures-and-cleanup';
if (!approved)
  throw Error(
    'The human approver must approve the exact task22 fixtures and cleanup before this harness runs',
  );
const fixtureRun = randomBytes(6).toString('hex');
const evidence = resolve('/private/tmp', `task22-native-${version}-${fixtureRun}`);
mkdirSync(evidence, { recursive: true });
const bundle = readFileSync(resolve(root, 'dist/module/main.js'));
const sha = createHash('sha256').update(bundle).digest('hex');
const store = openStore(paths.db);
const registry = new LinkRegistry();
const link = new LinkServer({
  port: config.linkPort,
  store,
  codes: new PairingCodes(),
  registry,
  allowedOrigins: [config.foundryOrigin],
  gatewayVersion: '0.1.0',
});
await link.listen();
const browsers: Array<Awaited<ReturnType<typeof openUserBrowser>>> = [];
const sessions: Array<{ client: Client; server: ReturnType<typeof createSessionServer> }> = [];
const outstandingBatches: Promise<unknown>[] = [];
const completedAuditKeys: string[] = [];
const retainedAuditUuids: string[] = [];
let auditBaseline: string[] = [];
let gmBrowser: (typeof browsers)[number] | undefined;
let playerBrowser: (typeof browsers)[number] | undefined;
const created: string[] = [];
const savedViews = new Map<
  (typeof browsers)[number],
  { sceneId: string | null; targets: string[]; combatUuid: string | null }
>();
let originalCombats: Array<{ uuid: string; active: boolean; round: number; turn: number | null }> =
  [];
let originalWorldTime: number | undefined;
let complete = false;
let cleaned = false;
async function drainAudit() {
  if (!gmBrowser || !completedAuditKeys.length) return;
  const rows = await waitForLiveAudit(async () => {
    const facts = await gmBrowser!.page.evaluate(readNativeAuditRows, auditBaseline);
    const rows = facts.map((r: any) => ({
      ...r,
      key: liveAuditKey(r.userId, r.agentId, r.tool, JSON.parse(r.args)),
    }));
    retainNativeAudit(rows, completedAuditKeys, retainedAuditUuids);
    return rows;
  }, completedAuditKeys);
  for (const row of rows)
    if (completedAuditKeys.includes(row.key) && !retainedAuditUuids.includes(row.uuid))
      retainedAuditUuids.push(row.uuid);
}
async function session(user: string, userId: string) {
  const server = createSessionServer({
    version: '0.1.0',
    registry,
    selector: { world: config.world, user },
    knownIdentities: () =>
      store
        .listActivePairings()
        .map((p) => ({ worldId: p.worldId, userId: p.userId, userName: p.userName })),
    log: () => {},
  });
  const client = new Client({ name: 'task22-native-acceptance', version: '0.0.0-test' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  sessions.push({ client, server });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return {
      isError: result.isError === true,
      text: (result.content as any[])
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n'),
      structured: result.structuredContent as any,
    };
  };
  const approvedCall = async (
    name: string,
    args: Record<string, unknown>,
    expectDenied = false,
  ) => {
    const agentId = registry.get(config.world, userId)?.agentId;
    if (!agentId) throw Error('The exact paired agent is unavailable');
    completedAuditKeys.push(liveAuditKey(userId, agentId, name, args));
    let result = await call(name, args);
    if (result.structured?.status === 'pending_approval') {
      const id = result.structured.id;
      console.log(
        `[task22] PENDING ${version} ${name}: status=pending_approval idPresent=${typeof id === 'string'} at=${new Date().toISOString()}`,
      );
      for (let i = 0; i < 600; i++) {
        const status = await call('approval_status', { id });
        if (status.isError || ['denied', 'expired'].includes(status.structured?.status))
          throw Error(`${name} approval failed: ${status.text}`);
        if (status.structured?.result !== undefined) {
          console.log(
            `[task22] POLL ${version} ${name}: completed resultPresent=true at=${new Date().toISOString()}`,
          );
          result = {
            isError: status.structured.resultFailed === true,
            text: status.structured.result,
            structured: undefined,
          };
          break;
        }
        await new Promise((done) => setTimeout(done, 1000));
        if (i === 599) throw Error(`Timed out waiting for the human approver to approve ${name}`);
      }
    }
    if (result.isError !== expectDenied) throw Error(`${name}: unexpected result ${result.text}`);
    if (expectDenied && !result.text.includes('FORBIDDEN'))
      throw Error('Expected native permission refusal');
    return result;
  };
  return { client, call, approvedCall };
}
async function open(user: string) {
  const browser = await openUserBrowser(config, paths, user, { headed: true });
  browsers.push(browser);
  browser.page.on('console', (message) => {
    const text = message.text();
    if (text.startsWith('agent-gateway |') && ['error', 'warning'].includes(message.type()))
      console.log(`[task22] NATIVE ${version} ${text}`);
  });
  let servedBundle = false;
  for (const [pattern, path, contentType] of [
    [
      '**/modules/agent-gateway/dist/module/main.js*',
      resolve(root, 'dist/module/main.js'),
      'text/javascript',
    ],
    ['**/modules/agent-gateway/lang/en.json*', resolve(root, 'lang/en.json'), 'application/json'],
    [
      '**/modules/agent-gateway/styles/agent-gateway.css*',
      resolve(root, 'styles/agent-gateway.css'),
      'text/css',
    ],
  ])
    await browser.context.route(pattern!, async (route) => {
      if (path === resolve(root, 'dist/module/main.js')) {
        const bytes = readFileSync(path);
        if (createHash('sha256').update(bytes).digest('hex') !== sha)
          throw Error('Production bundle changed during native acceptance');
        await route.fulfill({ body: bytes, contentType });
        servedBundle = true;
      } else await route.fulfill({ path, contentType });
    });
  await joinWorld(asJoinPage(browser.page), config, user);
  if (!servedBundle) throw Error('Verified production bundle was not served to the actual browser');
  const policy = readNativeWritePolicy(
    await browser.page.evaluate(() =>
      (globalThis as any).game.settings.get('agent-gateway', 'worldPolicy'),
    ),
  );
  if (policy.gm !== 'ask_owner' || policy.player !== 'ask_owner')
    throw Error('World policy differs from the approved default owner-approval test plan');
  await browser.page.evaluate(
    ({ source, path }) => {
      const h = (globalThis as any).Handlebars;
      h.registerPartial(path, h.compile(source));
    },
    {
      path: 'modules/agent-gateway/templates/approval/approval.hbs',
      source: readFileSync(resolve(root, 'templates/approval/approval.hbs'), 'utf8'),
    },
  );
  return browser;
}

try {
  gmBrowser = await open(config.gmUser);
  const preflight = await gmBrowser.page.evaluate(readNativeReadiness, {
    playerName: config.playerUser,
    version,
  });
  console.log(`[task22] PREFLIGHT ${version}: ${JSON.stringify(preflight)} bundle=${sha}`);
  originalWorldTime = preflight.worldTime;
  originalCombats = await gmBrowser.page.evaluate(() =>
    (globalThis as any).game.combats.contents.map((c: any) => ({
      uuid: c.uuid,
      active: c.active,
      round: c.round,
      turn: c.turn,
    })),
  );
  auditBaseline = await gmBrowser.page.evaluate(() => {
    const g = (globalThis as any).game;
    return g.journal
      .get(g.settings.get('agent-gateway', 'auditJournalId'))
      .pages.contents.map((p: any) => p.uuid);
  });
  playerBrowser = await open(preflight.player.name);
  for (const browser of [gmBrowser, playerBrowser])
    savedViews.set(
      browser,
      await browser.page.evaluate(() => {
        const g = globalThis as any;
        return {
          combatUuid: g.ui.combat.viewed?.uuid ?? null,
          sceneId: g.canvas.scene?.id ?? null,
          targets: [...g.game.user.targets].map((t: any) => t.id),
        };
      }),
    );
  const mark = { fixture: true, task: 22, run: fixtureRun };
  // Track each successful creation before issuing the next, including partial setup failures.
  async function create(kind: 'Actor' | 'Scene' | 'Combat', data: any) {
    const uuid = await gmBrowser!.page.evaluate(
      async ({ kind, data }) => {
        const g = globalThis as any;
        const d = await g.CONFIG[kind].documentClass.create(data, { renderSheet: false });
        if (!d?.uuid) throw Error('Native create returned no UUID');
        return d.uuid;
      },
      { kind, data },
    );
    created.push(uuid);
    return uuid;
  }
  const ownedActor = await create('Actor', {
    name: `Task22 owned ${fixtureRun}`,
    type: 'npc',
    system: {},
    ownership: { default: 0, [preflight.player.id]: 3 },
    flags: { 'agent-gateway': mark },
  });
  const unownedActor = await create('Actor', {
    name: `Task22 unowned ${fixtureRun}`,
    type: 'npc',
    system: {},
    ownership: { default: 0 },
    flags: { 'agent-gateway': mark },
  });
  const sceneUuid = await create('Scene', {
    name: `Task22 scene ${fixtureRun}`,
    width: 3000,
    height: 3000,
    padding: 0,
    grid: { type: 1, size: 100, distance: 5, units: 'ft' },
    tokenVision: false,
    navigation: false,
    ownership: { default: 0, [preflight.player.id]: 2 },
    flags: { 'agent-gateway': mark },
  });
  const tokens: string[] = [];
  for (const [index, actorUuid, hidden] of [
    [0, ownedActor, true],
    [1, ownedActor, false],
    [2, unownedActor, false],
  ] as const) {
    const uuid = await gmBrowser.page.evaluate(
      async ({ sceneUuid, actorUuid, hidden, index, mark }) => {
        const g = globalThis as any;
        const scene = await g.fromUuid(sceneUuid);
        const actor = await g.fromUuid(actorUuid);
        const data = (
          await actor.getTokenDocument({
            name: `Task22 token ${index}`,
            actorLink: true,
            x: 300 + index * 300,
            y: 300,
            hidden,
            sight: { enabled: false },
            texture: { src: 'icons/svg/mystery-man.svg' },
            flags: { 'agent-gateway': mark },
          })
        ).toObject();
        delete data._id;
        const [t] = await scene.createEmbeddedDocuments('Token', [data]);
        return t.uuid;
      },
      { sceneUuid, actorUuid, hidden, index, mark },
    );
    created.push(uuid);
    tokens.push(uuid);
  }
  const combatUuid = await create('Combat', {
    name: `Task22 combat ${fixtureRun}`,
    scene: sceneUuid.split('.').at(-1),
    round: 1,
    turn: 0,
    active: true,
    flags: { 'agent-gateway': mark },
  });
  const combatants: string[] = [];
  for (let i = 0; i < 3; i++) {
    const uuid = await gmBrowser.page.evaluate(
      async ({ combatUuid, tokenUuid, index, mark }) => {
        const g = globalThis as any;
        const c = await g.fromUuid(combatUuid);
        const t = await g.fromUuid(tokenUuid);
        const [d] = await c.createEmbeddedDocuments('Combatant', [
          {
            name: `Task22 combatant ${index}`,
            tokenId: t.id,
            actorId: t.actor.id,
            sceneId: t.parent.id,
            hidden: index === 0,
            initiative: 30 - index * 10,
            flags: { 'agent-gateway': mark },
          },
        ]);
        return d.uuid;
      },
      { combatUuid, tokenUuid: tokens[i]!, index: i, mark },
    );
    created.push(uuid);
    combatants.push(uuid);
  }
  for (const browser of [gmBrowser, playerBrowser])
    await browser.page.evaluate(
      async ({ sceneUuid, combatUuid }) => {
        const g = globalThis as any;
        await (await g.fromUuid(sceneUuid)).view();
        await g.ui.combat.render(true);
        g.ui.combat.viewed = await g.fromUuid(combatUuid);
      },
      { sceneUuid, combatUuid },
    );
  const mcp = await session(preflight.player.name, preflight.player.id);
  for (let i = 0; i < 30; i++) {
    if (!(await mcp.call('world_info')).isError) break;
    if (i === 29) throw Error('Player link unavailable');
    await new Promise((r) => setTimeout(r, 1000));
  }
  const listed = await mcp.client.listTools();
  for (const name of ['token_move', 'target_set', 'combat_status', 'combat_end_turn'])
    if (!listed.tools.some((t) => t.name === name)) throw Error('Expected task22 tool missing');
  const hiddenStatus = await mcp.call('combat_status');
  if (
    hiddenStatus.isError ||
    hiddenStatus.structured.currentCombatantUuid !== undefined ||
    JSON.stringify(hiddenStatus).includes(combatants[0]!) ||
    JSON.stringify(hiddenStatus).includes('Task22 combatant 0')
  )
    throw Error('Hidden-current privacy failed');
  await gmBrowser.page.evaluate(
    async ({ combatUuid }) => {
      const g = globalThis as any;
      const c = await g.fromUuid(combatUuid);
      if (c.getTimeDelta(1, 1, 1, 2) !== 0) throw Error('Nonzero native time delta');
      await c.update({ turn: 1 });
    },
    { combatUuid },
  );
  const status = await mcp.call('combat_status');
  if (status.structured.currentCombatantUuid !== combatants[1])
    throw Error('Owned fixture turn is not current');
  const moveArgs = {
    tokenUuid: tokens[1]!,
    path: [
      { x: 7, y: 3 },
      { x: 8, y: 4 },
    ],
  };
  const targetArgs = { tokenUuids: [tokens[1]!, tokens[2]!], mode: 'replace' };
  const endArgs = { combatUuid, currentCombatantUuid: combatants[1]!, round: 1, turn: 1 };
  const batch = startLiveBatch([
    mcp.approvedCall('token_move', moveArgs),
    mcp.approvedCall('target_set', targetArgs),
    mcp.approvedCall('combat_end_turn', endArgs),
    mcp.approvedCall('token_move', { tokenUuid: tokens[2]!, x: 10, y: 10 }, true),
    mcp.approvedCall('target_set', { tokenUuids: [tokens[0]!], mode: 'replace' }, true),
  ]);
  outstandingBatches.push(batch.settled);
  await waitForNativeApprovals(playerBrowser.page, 5);
  await playerBrowser.page.bringToFront();
  console.log(
    `[task22] READY ${version} Player1: five real owner approval requests (three allowed, two expected permission refusals).`,
  );
  await playerBrowser.page.screenshot({ path: resolve(evidence, 'approval.png') });
  await batch.result(drainAudit);
  const second = startLiveBatch([
    mcp.approvedCall(
      'combat_end_turn',
      { combatUuid, currentCombatantUuid: combatants[2]!, round: 1, turn: 2 },
      true,
    ),
  ]);
  outstandingBatches.push(second.settled);
  await waitForNativeApprovals(playerBrowser.page, 1);
  await playerBrowser.page.bringToFront();
  console.log(
    `[task22] READY ${version} Player1: final unowned-turn request; approve to verify native refusal.`,
  );
  await second.result(drainAudit);
  const facts = await gmBrowser.page.evaluate(
    async ({ tokens, combatUuid, retained, worldTime }) => {
      const g = globalThis as any;
      const owned = await g.fromUuid(tokens[1]);
      const unowned = await g.fromUuid(tokens[2]);
      const combat = await g.fromUuid(combatUuid);
      const rows = await Promise.all(
        retained.map(async (uuid: string) => (await g.fromUuid(uuid)).system),
      );
      if (
        owned.x !== 800 ||
        owned.y !== 400 ||
        unowned.x !== 900 ||
        unowned.y !== 300 ||
        combat.round !== 1 ||
        combat.turn !== 2 ||
        g.game.time.worldTime !== worldTime
      )
        throw Error('Native mutation or zero-time assertion failed');
      if (
        rows.length !== 6 ||
        rows.filter((r) => r.status === 'ok').length !== 3 ||
        rows.filter((r) => r.status === 'error').length !== 3
      )
        throw Error('Audit outcomes mismatch');
      const targets = rows.filter((r) => r.tool === 'target_set');
      if (targets.some((r) => r.targets.length))
        throw Error('Transient target has fabricated undo target');
      const end = rows.find((r) => r.tool === 'combat_end_turn' && r.status === 'ok');
      if (
        end.targets.length !== 1 ||
        end.targets[0].uuid !== combatUuid ||
        end.targets[0].undoable !== false
      )
        throw Error('Combat audit must be view-only');
      return {
        rows,
        worldTimeUnchanged: true,
        moved: true,
        unownedUnchanged: true,
        combatTurn: combat.turn,
      };
    },
    { tokens, combatUuid, retained: retainedAuditUuids, worldTime: preflight.worldTime },
  );
  const targetFacts = await playerBrowser.page.evaluate(
    ({ tokens }) => {
      const g = globalThis as any;
      const actual = [...g.game.user.targets].map((t: any) => t.document.uuid).sort();
      if (JSON.stringify(actual) !== JSON.stringify([tokens[1], tokens[2]].sort()))
        throw Error('Native caller targets incorrect');
      return { targets: actual };
    },
    { tokens },
  );
  writeFileSync(
    resolve(evidence, 'native-facts.json'),
    JSON.stringify(
      { sourceBundle: sha, version, fixtureRun, preflight, created, facts, targetFacts },
      null,
      2,
    ),
  );
  await playerBrowser.page.screenshot({ path: resolve(evidence, 'native-board.png') });
  complete = true;
  console.log(
    `[task22] PASS ${version}: four tools; hidden-current privacy; owned move/targets/turn; three refusals; six actual audits; zero world-time delta.`,
  );
} finally {
  if (gmBrowser)
    try {
      try {
        await drainAudit();
      } catch (error) {
        console.error(`[task22] audit drain: ${String(error)}`);
      }
      // Every dispatched write belongs to Player1; invalidate its pending requests while
      // preserving the designated GM's live relay buffer through settlement and drain.
      if (!complete && playerBrowser) {
        await playerBrowser.page.reload();
        await playerBrowser.page.waitForFunction('globalThis.game?.ready===true');
      }
      await Promise.all(outstandingBatches);
      try {
        await drainAudit();
      } catch (error) {
        console.error(`[task22] audit drain: ${String(error)}`);
      }
      await cleanupNativeFixtures({
        hasFixtureCombat: created.some(
          (uuid) => uuid.startsWith('Combat.') && uuid.split('.').length === 2,
        ),
        clearViewed: async () => {
          for (const browser of [gmBrowser, playerBrowser])
            if (browser)
              await browser.page.evaluate(() => {
                (globalThis as any).ui.combat.viewed = null;
              });
        },
        deleteFixtures: async () => {
          // Delete exact returned top-level records only; child UUIDs are checked absent afterwards.
          for (const uuid of [...created].reverse().filter((uuid) => uuid.split('.').length === 2))
            await gmBrowser!.page.evaluate(
              async ({ uuid, run }) => {
                const g = globalThis as any;
                const d = await g.fromUuid(uuid);
                if (!d) return;
                if (
                  d.flags?.['agent-gateway']?.task !== 22 ||
                  d.flags?.['agent-gateway']?.run !== run
                )
                  throw Error('Fixture cleanup identity mismatch');
                await d.delete();
              },
              { uuid, run: fixtureRun },
            );
        },
        restoreViews: async () => {
          for (const browser of [gmBrowser, playerBrowser]) {
            const view = browser ? savedViews.get(browser) : undefined;
            if (browser && view)
              await browser.page.evaluate(async (view) => {
                const g = globalThis as any;
                if (view.sceneId) {
                  const scene = g.game.scenes.get(view.sceneId);
                  if (!scene) throw Error('Previous scene unavailable');
                  await scene.view();
                  g.canvas.tokens.setTargets(view.targets, { mode: 'replace' });
                } else {
                  await g.canvas.draw(null);
                  g.canvas.tokens.setTargets([], { mode: 'replace' });
                }
                g.ui.combat.viewed = view.combatUuid ? await g.fromUuid(view.combatUuid) : null;
                const actualTargets = [...g.game.user.targets].map((t: any) => t.id).sort();
                if (
                  (g.canvas.scene?.id ?? null) !== view.sceneId ||
                  (g.ui.combat.viewed?.uuid ?? null) !== view.combatUuid ||
                  JSON.stringify(actualTargets) !== JSON.stringify([...view.targets].sort())
                )
                  throw Error('Original personal view/targets were not restored');
              }, view);
          }
        },
      });
      const readback = await gmBrowser.page.evaluate(
        async ({ absent, retained, originalCombats, originalWorldTime }) => {
          const g = globalThis as any;
          if (originalWorldTime !== undefined && g.game.time.worldTime !== originalWorldTime)
            throw Error('World time changed during native acceptance or cleanup');
          for (const before of originalCombats) {
            const now = await g.fromUuid(before.uuid);
            if (
              !now ||
              now.active !== before.active ||
              now.round !== before.round ||
              now.turn !== before.turn
            )
              throw Error('An original combat changed during native acceptance or cleanup');
          }
          for (const uuid of absent)
            if (await g.fromUuid(uuid)) throw Error('Fixture remains after cleanup');
          for (const uuid of retained)
            if (!(await g.fromUuid(uuid))) throw Error('Audit disappeared during cleanup');
          return {
            absent: absent.length,
            retained: retained.length,
            originalCombatsUnchanged: originalCombats.length,
            worldTimeUnchanged: true,
            personalViewsRestored: true,
            foundryVersion: g.game.version,
          };
        },
        { absent: created, retained: retainedAuditUuids, originalCombats, originalWorldTime },
      );
      writeFileSync(resolve(evidence, 'cleanup.json'), JSON.stringify(readback, null, 2));
      cleaned = true;
      console.log(`[task22] CLEAN ${version}: ${JSON.stringify(readback)}`);
    } catch (error) {
      console.error(`[task22] CLEANUP FAILED ${version}: ${String(error)}`);
    }
  for (const { client, server } of sessions) {
    await client.close();
    await server.close();
  }
  for (const browser of browsers) await browser.context.close();
  await link.close();
  store.close();
}
if (!complete || !cleaned) throw Error('Native task22 acceptance or exact cleanup failed');
console.log(`[task22] COMPLETE ${version} bundle=${sha} evidence=${evidence}`);
