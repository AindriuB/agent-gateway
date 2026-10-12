/* eslint-disable @typescript-eslint/no-explicit-any */
/** Opt-in native proof: exact consented fixture only, gateway reads never forwarded to Foundry. */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { parseLinkMessage } from '@agent-gateway/protocol';
import { loadContext } from '../../../e2e/lib/context.js';
import { openUserBrowser, joinWorld, asJoinPage } from '../../../e2e/lib/browser.js';
import { LinkRegistry, LinkServer, PairingCodes } from '../../src/link/index.js';
import { EventBuffer } from '../../src/events/index.js';
import { toolsets } from '../../src/routing/index.js';
import { createSessionServer } from '../../src/mcp/session.js';
import { openStore } from '../../src/store/index.js';
import { task27OwnedSocket, task27DropSocket } from '../../../module/test/events/native-plan.js';
import {
  task28Pins,
  task28Plan,
  assertTask28Read,
  task28ReadPairings,
  task28Track,
  task28Drain,
} from './native-plan.js';
import { task28NativeState, task28ParticipantState } from './native-state.js';
const pins = task28Pins(
    process.env.AGENT_GATEWAY_TASK28_SOURCE,
    process.env.AGENT_GATEWAY_TASK28_BUNDLE,
  ),
  generation = Number(process.env.AGENT_GATEWAY_TASK28_GENERATION) as 13 | 14;
if (
  ![13, 14].includes(generation) ||
  process.env.AGENT_GATEWAY_TASK28_APPROVED !== 'exact-private-actor-and-cleanup'
)
  throw Error('Fresh exact Task28 fixture consent required');
const root = fileURLToPath(new URL('../../../', import.meta.url)),
  { config, paths } = loadContext();
if (
  new URL(config.foundryOrigin).hostname !==
    (generation === 13 ? 'foundry13.local' : 'foundry.local') ||
  config.world !== 'test-world' ||
  config.linkPort !== (generation === 13 ? 7439 : 7429) ||
  !existsSync(paths.db)
)
  throw Error('Exact paired native target required');
const bundle = readFileSync(resolve(root, 'dist/module/main.js')),
  hash = createHash('sha256').update(bundle).digest('hex');
if (
  hash !== pins.bundle ||
  execFileSync('git', ['rev-parse', `${pins.source}^{commit}`], {
    cwd: root,
    encoding: 'utf8',
  }).trim() !== pins.source ||
  execFileSync('git', ['diff', pins.source, '--', 'module/src', 'protocol/src', 'gateway/src'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
)
  throw Error('Reviewed source/bundle changed');
const run = randomBytes(6).toString('hex'),
  evidence = resolve('/private/tmp', `task28-native-v${generation}-${run}`);
mkdirSync(evidence, { recursive: true, mode: 0o700 });
const save = (name: string, value: unknown) =>
  writeFileSync(resolve(evidence, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const importedPairings = task28ReadPairings(paths.db, config.world),
  store = openStore(resolve(evidence, 'isolated.db'));
for (const pair of importedPairings) store.createPairing(pair);
const registry = new LinkRegistry(),
  events = new EventBuffer(store, registry),
  link = new LinkServer({
    port: config.linkPort,
    store,
    registry,
    events,
    codes: new PairingCodes(),
    allowedOrigins: [config.foundryOrigin],
    gatewayVersion: '0.1.0',
  });
type Participant = {
  browser: Awaited<ReturnType<typeof openUserBrowser>>;
  user: any;
  principal: any;
  baseline: any;
  frames: any[];
  welcomes: any[];
};
const participants: Participant[] = [],
  clients: Client[] = [],
  calls: any[] = [];
const pendingCalls = new Set<Promise<unknown>>();
let baseline: any,
  plan: any,
  uuid = '',
  fixtureAttempted = false,
  complete = false,
  cleaned = false,
  captureError = '',
  nativeCalls = 0;
async function state(op: string, extra: Record<string, unknown> = {}) {
  return participants[0]!.browser.page.evaluate(task28NativeState, {
    op,
    run,
    generation,
    baseline,
    plan,
    uuid,
    playerName: config.playerUser,
    ...extra,
  });
}
function live(p: Participant) {
  const c = registry.get(config.world, p.user.id);
  if (
    captureError ||
    !c ||
    c.closed ||
    c.agentId !== p.principal.agentId ||
    !store.isPairingActive(c.agentId, c.worldId, c.userId) ||
    c.worldId !== config.world ||
    c.userId !== p.user.id ||
    c.info.isGM !== (p.user.id === baseline.gm.id) ||
    !toolsets.get(c)
  )
    throw Error('Exact native principal/announcement changed');
  return c;
}
async function until(check: () => boolean, timeout = 15000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw Error('Bounded native readiness deadline');
    await delay(50);
  }
}
async function open(name: string, index: number): Promise<Participant> {
  const browser = await openUserBrowser(config, paths, name, { headed: true }),
    frames: any[] = [],
    welcomes: any[] = [];
  try {
    let served = 0,
      sockets = 0;
    browser.page.on('websocket', (ws) => {
      if (new URL(ws.url()).port !== String(config.linkPort)) return;
      const connection = `${index}/${++sockets}`;
      ws.on('framesent', ({ payload }) => {
        try {
          const parsed = parseLinkMessage(payload);
          if (!parsed.ok) throw Error('Invalid native outgoing frame');
          if (parsed.message.type === 'event') {
            if (frames.length >= 5000) throw Error('Native capture cap');
            frames.push({ connection, event: parsed.message.event });
          }
        } catch {
          captureError = 'Malformed/oversized native outgoing frame';
        }
      });
      ws.on('framereceived', ({ payload }) => {
        try {
          const parsed = parseLinkMessage(payload);
          if (!parsed.ok) throw Error('Invalid native incoming frame');
          if (parsed.message.type === 'welcome')
            welcomes.push({ connection, id: parsed.message.connectionId });
          if (parsed.message.type === 'call') {
            nativeCalls++;
            captureError = 'Gateway-owned read unexpectedly forwarded to native module';
          }
        } catch {
          captureError = 'Malformed/oversized native incoming frame';
        }
      });
    });
    await browser.context.route('**/modules/agent-gateway/dist/module/main.js*', async (route) => {
      const bytes = readFileSync(resolve(root, 'dist/module/main.js'));
      if (createHash('sha256').update(bytes).digest('hex') !== hash)
        throw Error('Routed source changed');
      await route.fulfill({ body: bytes, contentType: 'text/javascript' });
      served++;
    });
    await joinWorld(asJoinPage(browser.page), config, name);
    await browser.page.waitForFunction('game.ready && !canvas.loading');
    if (!served) throw Error('Reviewed native bundle route missing');
    return {
      browser,
      user: undefined,
      principal: undefined,
      baseline: undefined,
      frames,
      welcomes,
    };
  } catch (error) {
    await browser.context.close();
    throw error;
  }
}
async function session(p: Participant) {
  const client = new Client({ name: 'task28-native', version: '0' }),
    server = createSessionServer({
      version: '0.1.0',
      registry,
      events,
      selector: { world: config.world, user: p.user.id },
      knownIdentities: () =>
        store
          .listActivePairings()
          .map((row) => ({ worldId: row.worldId, userId: row.userId, userName: row.userName })),
      log() {},
    });
  clients.push(client);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
function call(client: Client, p: Participant, args: Record<string, unknown>, signal?: AbortSignal) {
  return task28Track(
    pendingCalls,
    (async () => {
      live(p);
      const record = { args, terminal: false } as any;
      calls.push(record);
      save('calls.json', calls);
      try {
        const result = await client.callTool(
          { name: 'events_poll', arguments: args },
          undefined,
          signal ? { signal } : undefined,
        );
        record.result = result;
        record.terminal = true;
        save('calls.json', calls);
        if (result.isError) throw Error('Native gateway poll returned error');
        return assertTask28Read(
          result.structuredContent,
          p.user.id,
          p.user.id === baseline.player.id ? [uuid, plan.prefix] : [],
        );
      } catch (error) {
        record.terminal = true;
        record.failed = true;
        save('calls.json', calls);
        throw error;
      }
    })(),
  );
}
try {
  await link.listen();
  participants.push(await open(config.gmUser, 0));
  baseline = await state('baseline');
  plan = task28Plan(run, baseline.gm.id);
  participants[0]!.user = baseline.gm;
  save('baseline.json', { source: pins.source, bundle: hash, run, plan, baseline });
  await until(
    () =>
      !!registry.get(config.world, baseline.gm.id) &&
      !!toolsets.get(registry.get(config.world, baseline.gm.id)!),
  );
  const socket = task27OwnedSocket(link);
  participants.push(await open(config.playerUser, 1));
  participants[1]!.user = baseline.player;
  for (const p of participants) {
    const pairs = store
      .listActivePairings()
      .filter((row) => row.worldId === config.world && row.userId === p.user.id);
    if (pairs.length !== 1) throw Error('Exact unique native pairing required');
    p.principal = { agentId: pairs[0]!.id };
    await until(
      () =>
        !!registry.get(config.world, p.user.id) &&
        !!toolsets.get(registry.get(config.world, p.user.id)!),
    );
    live(p);
    p.baseline = await p.browser.page.evaluate(task28ParticipantState, {
      generation,
      user: p.user,
      isGM: p === participants[0],
      worldTime: baseline.worldTime,
    });
  }
  const gm = participants[0]!,
    player = participants[1]!,
    gmConn = live(gm);
  events.authorize(gmConn);
  const playerAllowed = toolsets.eventReadAllowed(live(player));
  save('readiness.json', {
    gmAllowed: true,
    playerAllowed,
    participants: participants.map((p) => ({
      user: p.user,
      principal: p.principal,
      baseline: p.baseline,
    })),
  });
  const a = await session(gm),
    b = await session(gm),
    pc = await session(player);
  const gmList = await a.listTools(),
    playerList = await pc.listTools();
  save('tool-lists.json', { gm: gmList, player: playerList });
  if (
    !gmList.tools.some((t) => t.name === 'events_poll') ||
    gmList.tools.some((t) => t.name === 'events_history') ||
    playerList.tools.some((t) => t.name === 'events_history') ||
    playerList.tools.some((t) => t.name === 'events_poll') !== playerAllowed
  )
    throw Error('Native tool visibility mismatch');
  const history = await a.callTool({
    name: 'events_history',
    arguments: { since: new Date().toISOString() },
  });
  save('history-refusal.json', history);
  if (!history.isError || !JSON.stringify(history.content).includes('FORBIDDEN:'))
    throw Error('Native hidden history refusal missing');
  events.authorize(live(gm));
  live(player);
  fixtureAttempted = true;
  const made = await state('create');
  uuid = made.uuid;
  save('created.json', made);
  await until(() =>
    store.events
      .read(
        { worldId: config.world, userId: gm.user.id, agentId: gm.principal.agentId },
        undefined,
        100,
      )
      .events.some((row) => 'doc' in row.event && row.event.doc?.uuid === uuid),
  );
  const first = await call(a, gm, {}),
    again = await call(b, gm, {});
  if (
    JSON.stringify(first) !== JSON.stringify(again) ||
    !first.events.some(
      (row) =>
        row.event.type === 'actor_create' && 'doc' in row.event && row.event.doc?.uuid === uuid,
    )
  )
    throw Error('Native nondestructive create read mismatch');
  let cursor = first.nextAfter;
  const started = Date.now(),
    timeout = await call(a, gm, { after: cursor });
  save('timeout.json', { elapsed: Date.now() - started, result: timeout });
  if (Date.now() - started < 24000 || timeout.events.length || timeout.nextAfter !== cursor)
    throw Error('Native 25-second timeout cursor changed');
  const wake = call(a, gm, { after: cursor });
  await until(() => events.pendingCount === 1);
  save('rename1.json', await state('rename', { index: 0 }));
  const changed = await wake;
  if (
    !changed.events.some(
      (row) =>
        'doc' in row.event &&
        row.event.doc?.uuid === uuid &&
        row.event.doc.name === plan.names[0] &&
        row.event.type === 'actor_update',
    )
  )
    throw Error('Native buffered rename wake absent');
  cursor = changed.nextAfter;
  const abort = new AbortController(),
    cancel = call(a, gm, { after: cursor }, abort.signal).then(
      () => {
        throw Error('Cancelled poll unexpectedly succeeded');
      },
      () => undefined,
    );
  await until(() => events.pendingCount === 1);
  abort.abort();
  await cancel;
  await until(() => events.pendingCount === 0);
  const disconnected = call(a, gm, { after: cursor }).then(
    () => {
      throw Error('Disconnected poll unexpectedly succeeded');
    },
    () => undefined,
  );
  await until(() => events.pendingCount === 1);
  task27DropSocket(link, socket, gmConn, registry.get(config.world, gm.user.id));
  await disconnected;
  await until(
    () =>
      registry.get(config.world, gm.user.id) !== gmConn &&
      !!registry.get(config.world, gm.user.id) &&
      !!toolsets.get(registry.get(config.world, gm.user.id)!),
  );
  const reconnected = live(gm);
  events.authorize(reconnected);
  const gap = await call(a, gm, { after: cursor });
  save('reconnect.json', { oldConnection: gmConn.id, newConnection: reconnected.id, result: gap });
  if (
    gap.events.filter((row) => row.event.type === 'gap').length !== 1 ||
    !gap.events.some(
      (row) => row.event.type === 'gap' && 'missed' in row.event && row.event.missed === 0,
    )
  )
    throw Error('Native reconnect gap mismatch');
  cursor = gap.nextAfter;
  save('rename2.json', await state('rename', { index: 1 }));
  await until(() =>
    store.events
      .read(
        { worldId: config.world, userId: gm.user.id, agentId: gm.principal.agentId },
        cursor,
        100,
      )
      .events.some((row) => 'doc' in row.event && row.event.doc?.name === plan.names[1]),
  );
  const next = await call(a, gm, { after: cursor });
  if (
    !next.events.some(
      (row) =>
        row.event.type === 'actor_update' &&
        'seq' in row.event &&
        row.event.seq === 1 &&
        'doc' in row.event &&
        row.event.doc?.name === plan.names[1],
    )
  )
    throw Error('Native reconnect sequence/cursor continuation mismatch');
  if (playerAllowed) {
    const rows = store.events.read(
      { worldId: config.world, userId: player.user.id, agentId: player.principal.agentId },
      undefined,
      100,
    );
    if (rows.events.length) await call(pc, player, {});
    else {
      const deniedActor = await call(pc, player, {});
      if (deniedActor.events.some((row) => 'doc' in row.event && row.event.doc?.uuid === uuid))
        throw Error('Private Actor reached Player1');
    }
  } else {
    const denied = await pc.callTool({ name: 'events_poll', arguments: {} });
    save('player-refusal.json', denied);
    if (!denied.isError || !JSON.stringify(denied.content).includes('FORBIDDEN:'))
      throw Error('Disabled native read was not refused');
  }
  save('facts.json', await state('facts'));
  const participantFinal = [];
  for (const p of participants) {
    const final = await p.browser.page.evaluate(task28ParticipantState, {
      generation,
      user: p.user,
      isGM: p === gm,
      worldTime: baseline.worldTime,
    });
    participantFinal.push(final);
    save('participants-final.json', participantFinal);
    if (JSON.stringify(final) !== JSON.stringify(p.baseline))
      throw Error('Native participant identity/view changed');
  }
  if (nativeCalls || captureError) throw Error('Native proof capture failed');
  complete = true;
} finally {
  let drained = false;
  try {
    await task28Drain(clients, pendingCalls);
    await until(() => events.pendingCount === 0);
    drained = calls.every((record) => record.terminal);
  } catch (error) {
    save('poll-drain-failure.json', {
      reason: error instanceof Error ? error.message : 'Poll drain refused',
    });
  }
  if (fixtureAttempted && !drained) {
    save('manual-reconciliation.json', {
      uuid,
      reason: 'Poll terminality unavailable; fixture cleanup refused',
    });
  } else if (fixtureAttempted) {
    if (!uuid) {
      save('manual-reconciliation.json', {
        reason: 'Fixture create attempted without a returned canonical identity',
      });
    } else {
      try {
        save('cleanup.json', await state('cleanup'));
        cleaned = true;
      } catch (error) {
        save('manual-reconciliation.json', {
          uuid,
          reason: error instanceof Error ? error.message : 'Cleanup refused',
        });
      }
    }
  } else cleaned = true;
  events.close();
  await Promise.all(participants.map((p) => p.browser.context.close()));
  await link.close();
  save('frames-final.json', {
    captureError,
    nativeCalls,
    participants: participants.map((p) => ({
      user: p.user,
      frames: p.frames,
      welcomes: p.welcomes,
    })),
  });
  store.close();
}
if (!complete || !cleaned || captureError)
  throw Error(`Task28 native incomplete; exact private evidence ${evidence}`);
console.log(
  `Task28 v${generation} COMPLETE ${run}; one fixture absent, no native tool/audit writes; evidence ${evidence}`,
);
