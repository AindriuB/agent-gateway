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
import {
  task29Pins,
  task29Plan,
  assertTask29Read,
  task29SettingSequence,
  task29PostPurgeCursor,
} from './offline-native-plan.js';
import { task28ReadPairings, task28Track, task28Drain } from './native-plan.js';
import {
  task29NativeState,
  task29ParticipantState,
  task29InstallUITracking,
  task29PreloadPolicyTemplate,
} from './offline-native-state.js';
const pins = task29Pins(
    process.env.AGENT_GATEWAY_TASK29_SOURCE,
    process.env.AGENT_GATEWAY_TASK29_BUNDLE,
  ),
  generation = Number(process.env.AGENT_GATEWAY_TASK29_GENERATION) as 13 | 14;
if (
  ![13, 14].includes(generation) ||
  process.env.AGENT_GATEWAY_TASK29_APPROVED !== 'exact-actor-policy-isolated-purge-and-cleanup'
)
  throw Error('Fresh exact Task29 fixture consent required');
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
const localeBytes = readFileSync(resolve(root, 'lang/en.json')),
  localeHash = createHash('sha256').update(localeBytes).digest('hex'),
  policyTemplate = readFileSync(resolve(root, 'templates/policy/policy.hbs')),
  templateHash = createHash('sha256').update(policyTemplate).digest('hex'),
  bundle = readFileSync(resolve(root, 'dist/module/main.js')),
  hash = createHash('sha256').update(bundle).digest('hex');
if (
  hash !== pins.bundle ||
  execFileSync('git', ['rev-parse', `${pins.source}^{commit}`], {
    cwd: root,
    encoding: 'utf8',
  }).trim() !== pins.source ||
  execFileSync(
    'git',
    [
      'diff',
      pins.source,
      '--',
      'module/src',
      'protocol/src',
      'gateway/src',
      'templates/policy',
      'lang/en.json',
    ],
    {
      cwd: root,
      encoding: 'utf8',
    },
  ).trim()
)
  throw Error('Reviewed source/bundle changed');
const run = randomBytes(6).toString('hex'),
  evidence = resolve('/private/tmp', `task29-native-v${generation}-${run}`);
mkdirSync(evidence, { recursive: true, mode: 0o700 });
const save = (name: string, value: unknown) =>
  writeFileSync(resolve(evidence, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const originalDbHash = createHash('sha256').update(readFileSync(paths.db)).digest('hex');
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
  calls: any[] = [],
  policyFrames: any[] = [];
let expectedPolicy: any,
  settingAttempted = false,
  settingRestored = false,
  linkListening = false;
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
  return participants[0]!.browser.page.evaluate(task29NativeState, {
    op,
    run,
    generation,
    baseline,
    plan,
    uuid,
    playerName: config.playerUser,
    expectedPolicy,
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
          if (parsed.message.type === 'eventPolicy' || parsed.message.type === 'purgeEvents') {
            policyFrames.push({ direction: 'sent', connection, message: parsed.message });
            save('policy-frames.json', policyFrames);
          }
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
            welcomes.push({
              connection,
              id: parsed.message.connectionId,
              protocol: parsed.message.protocolVersion,
            });
          if (parsed.message.type === 'purgeEventsResult') {
            policyFrames.push({ direction: 'received', connection, message: parsed.message });
            save('policy-frames.json', policyFrames);
          }
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
    await browser.context.route('**/modules/agent-gateway/templates/policy/policy.hbs*', (route) =>
      route.fulfill({
        body: policyTemplate,
        contentType: 'text/plain',
      }),
    );
    await browser.context.route('**/modules/agent-gateway/lang/en.json*', (route) =>
      route.fulfill({ body: localeBytes, contentType: 'application/json' }),
    );
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
  const client = new Client({ name: 'task29-native', version: '0' }),
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
function request(client: Client, name: string, args: Record<string, unknown>) {
  return task28Track(
    pendingCalls,
    (async () => {
      const record = { name, args, terminal: false } as any;
      calls.push(record);
      save('calls.json', calls);
      try {
        record.result = await client.callTool({ name, arguments: args });
        return record.result;
      } catch (error) {
        record.failed = error instanceof Error ? error.message : 'Request failed';
        throw error;
      } finally {
        record.terminal = true;
        save('calls.json', calls);
      }
    })(),
  );
}
async function read(client: Client, name = 'events_poll', args: Record<string, unknown> = {}) {
  const result = await request(client, name, args);
  if (result.isError) throw Error('Expected allowed event read');
  return assertTask29Read(result.structuredContent, baseline.gm.id);
}
async function refused(client: Client, name: string, code: string) {
  const result = await request(
    client,
    name,
    name === 'events_history' ? { since: new Date(0).toISOString() } : {},
  );
  if (!result.isError || !JSON.stringify(result.content).includes(`${code}:`))
    throw Error('Expected native gateway refusal absent');
}
async function savePolicy(value: any, label: string) {
  live(participants[0]!);
  await state('settingBefore');
  const page = participants[0]!.browser.page;
  await page.locator('#agent-gateway-policy [data-offline-enabled]').setChecked(value.enabled);
  await page.locator('#agent-gateway-policy [data-offline-days]').fill(String(value.retentionDays));
  await state('settingBefore');
  settingAttempted = true;
  // If the UI save applies then its acknowledgment fails, only this exact attempted value may be restored.
  expectedPolicy = value;
  await page.locator('#agent-gateway-policy [data-offline-save]').click();
  await page.waitForFunction(
    ({ value }: any) =>
      JSON.stringify(
        (globalThis as any).game.settings.get('agent-gateway', 'offlineEventReading'),
      ) === JSON.stringify(value),
    { value },
    { timeout: 10000 },
  );
  save(`setting-${label}.json`, await state('settingAfter'));
  await until(() => JSON.stringify(store.events.policy(config.world)) === JSON.stringify(value));
  await page.screenshot({ path: resolve(evidence, `policy-${label}.png`) });
}
async function disconnect() {
  live(participants[0]!);
  await link.close();
  linkListening = false;
  await until(() => !registry.get(config.world, baseline.gm.id));
}
async function reconnect() {
  await link.listen();
  linkListening = true;
  await until(() => {
    const c = registry.get(config.world, baseline.gm.id);
    return !!c && !!toolsets.get(c) && toolsets.eventReadAllowed(c);
  }, 30000);
  events.authorize(live(participants[0]!));
}
try {
  await link.listen();
  linkListening = true;
  participants.push(await open(config.gmUser, 0));
  baseline = await state('baseline');
  const expectedGM = importedPairings.filter((pair) => pair.userName === config.gmUser);
  if (
    expectedGM.length !== 1 ||
    baseline.gm.id !== expectedGM[0]!.userId ||
    baseline.gm.name !== config.gmUser
  )
    throw Error('Native GM identity differs from exact configured paired owner');
  const localized = await participants[0]!.browser.page.evaluate(() => {
    const game = (globalThis as any).game;
    const key = 'AGENT_GATEWAY.OfflineEvents.purged',
      template = game.i18n.localize(key);
    if (game.i18n.lang !== 'en' || template === key || !template.includes('{count}'))
      throw Error('Actual native localized count template unavailable');
    return template;
  });
  save('localized-readiness.json', { localeHash, localized });
  expectedPolicy = baseline.offlinePolicy;
  plan = task29Plan(run, baseline.gm.id);
  const gm = participants[0]!;
  gm.user = baseline.gm;
  const pairs = importedPairings.filter((p) => p.userId === gm.user.id);
  if (pairs.length !== 1) throw Error('Exact unique canonical GM pairing required');
  gm.principal = { agentId: pairs[0]!.id };
  await until(
    () =>
      !!registry.get(config.world, gm.user.id) &&
      !!toolsets.get(registry.get(config.world, gm.user.id)!),
  );
  events.authorize(live(gm));
  gm.baseline = await gm.browser.page.evaluate(task29ParticipantState, {
    generation,
    user: gm.user,
    isGM: true,
    worldTime: baseline.worldTime,
  });
  save('baseline.json', {
    source: pins.source,
    templateHash,
    localeHash,
    bundle: hash,
    run,
    plan,
    baseline,
    participant: gm.baseline,
  });
  const a = await session(gm),
    b = await session(gm);
  save('readiness.json', {
    gm: gm.user,
    principal: gm.principal,
    policy: store.events.policy(config.world),
    tools: await a.listTools(),
  });
  save(
    'template-preload.json',
    await gm.browser.page.evaluate(task29PreloadPolicyTemplate, policyTemplate.toString('utf8')),
  );
  await state('openPolicy');
  await gm.browser.page.locator('#agent-gateway-policy [data-offline-save]').waitFor();
  await gm.browser.page.evaluate(task29InstallUITracking);
  await savePolicy(task29SettingSequence[0], 'enabled');
  events.authorize(live(gm));
  await state('settingBefore');
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
  const online = await read(a);
  await disconnect();
  const offlineStart = Date.now(),
    offline = await read(a),
    again = await read(b);
  save('offline-enabled.json', {
    elapsed: Date.now() - offlineStart,
    online,
    offline,
    again,
    tools: await a.listTools(),
  });
  if (
    Date.now() - offlineStart > 5000 ||
    JSON.stringify(offline) !== JSON.stringify(again) ||
    !offline.events.some((row) => 'doc' in row.event && row.event.doc?.uuid === uuid)
  )
    throw Error('Offline immediate nondestructive fixture read failed');
  const history = await read(a, 'events_history', { since: new Date(0).toISOString() });
  save('history-enabled.json', history);
  if (!history.events.some((row) => 'doc' in row.event && row.event.doc?.uuid === uuid))
    throw Error('Offline history lacks fixture');
  await reconnect();
  save('rename1.json', await state('rename', { index: 0 }));
  await until(() =>
    store.events
      .read(
        { worldId: config.world, userId: gm.user.id, agentId: gm.principal.agentId },
        undefined,
        100,
      )
      .events.some((row) => 'doc' in row.event && row.event.doc?.name === plan.names[0]),
  );
  await savePolicy(task29SettingSequence[1], 'disabled');
  await disconnect();
  const disabledList = await a.listTools();
  save('offline-disabled-list.json', disabledList);
  if (disabledList.tools.some((t) => t.name === 'events_history'))
    throw Error('Disabled history listed');
  await refused(a, 'events_poll', 'WORLD_OFFLINE');
  await refused(a, 'events_history', 'WORLD_OFFLINE');
  await reconnect();
  await savePolicy(task29SettingSequence[2], 'reenabled');
  save('rename2.json', await state('rename', { index: 1 }));
  await until(() =>
    store.events
      .read(
        { worldId: config.world, userId: gm.user.id, agentId: gm.principal.agentId },
        undefined,
        100,
      )
      .events.some((row) => 'doc' in row.event && row.event.doc?.name === plan.names[1]),
  );
  const beforePurge = await read(a);
  const countBefore = store.events.history(
    { worldId: config.world, userId: gm.user.id, agentId: gm.principal.agentId },
    0,
    undefined,
    100,
  ).events.length;
  if (!countBefore || countBefore >= 100)
    throw Error('Bounded nonempty exact purge count required');
  await state('settingBefore');
  live(gm);
  await gm.browser.page.evaluate(() => {
    const g = globalThis as any;
    g.__task29Notices = [];
    g.__task29NoticeObserver = new MutationObserver(() => {
      for (const n of document.querySelectorAll('#notifications .notification')) {
        const text = n.textContent ?? '';
        if (!g.__task29Notices.includes(text)) g.__task29Notices.push(text);
      }
    });
    g.__task29NoticeObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  const purgeStart = policyFrames.length;
  await gm.browser.page.locator('#agent-gateway-policy [data-offline-purge]').click();
  await until(() =>
    policyFrames.slice(purgeStart).some((row) => row.message.type === 'purgeEventsResult'),
  );
  const requestFrame = policyFrames
      .slice(purgeStart)
      .filter((row) => row.message.type === 'purgeEvents'),
    replyFrames = policyFrames
      .slice(purgeStart)
      .filter((row) => row.message.type === 'purgeEventsResult');
  if (
    requestFrame.length !== 1 ||
    replyFrames.length !== 1 ||
    requestFrame[0].message.requestId !== replyFrames[0].message.requestId ||
    replyFrames[0].message.count !== countBefore
  )
    throw Error('Exact correlated isolated purge count failed');
  const expectedNotice = await gm.browser.page.evaluate(
    (count: number) =>
      (globalThis as any).game.i18n.format('AGENT_GATEWAY.OfflineEvents.purged', { count }),
    countBefore,
  );
  if (
    expectedNotice === 'AGENT_GATEWAY.OfflineEvents.purged' ||
    expectedNotice !== localized.replace('{count}', String(countBefore))
  )
    throw Error('Actual native localized purge count absent');
  await gm.browser.page.waitForFunction(
    (text: string) =>
      (globalThis as any).__task29Notices.some((value: string) => value.includes(text)),
    expectedNotice,
  );
  const afterPurge = await read(a, 'events_poll', task29PostPurgeCursor),
    emptyHistory = await read(a, 'events_history', { since: new Date(0).toISOString() });
  save('purge.json', {
    countBefore,
    request: requestFrame[0],
    reply: replyFrames[0],
    beforePurge,
    afterPurge,
    emptyHistory,
    expectedNotice,
    notices: await gm.browser.page.evaluate(() => (globalThis as any).__task29Notices),
  });
  if (
    afterPurge.events.length ||
    !afterPurge.cursorGap ||
    emptyHistory.events.length ||
    afterPurge.nextAfter < beforePurge.nextAfter
  )
    throw Error('Purged payload/cursor proof failed');
  await gm.browser.page.screenshot({ path: resolve(evidence, 'purge-count.png') });
  save('facts.json', await state('facts'));
  const final = await gm.browser.page.evaluate(task29ParticipantState, {
    generation,
    user: gm.user,
    isGM: true,
    worldTime: baseline.worldTime,
  });
  save('participant-final.json', final);
  if (JSON.stringify(final) !== JSON.stringify(gm.baseline) || nativeCalls || captureError)
    throw Error('Native baselines/capture failed');
  complete = true;
} finally {
  let drained = false,
    uiDrained = false;
  try {
    if (participants[0]) {
      await participants[0].browser.page.waitForFunction(
        () => ((globalThis as any).__task29UIOps ?? []).every((record: any) => record.terminal),
        undefined,
        { timeout: 12000 },
      );
      const uiOps = await participants[0].browser.page.evaluate(
        () => (globalThis as any).__task29UIOps ?? [],
      );
      save('ui-terminal.json', uiOps);
      if (uiOps.some((record: any) => record.failed)) complete = false;
    }
    uiDrained = true;
  } catch (error) {
    save('ui-drain-failure.json', {
      reason: error instanceof Error ? error.message : 'Native UI settlement unavailable',
    });
  }
  try {
    await task28Drain(clients, pendingCalls);
    await until(() => events.pendingCount === 0);
    drained = uiDrained && calls.every((record) => record.terminal);
  } catch (error) {
    save('poll-drain-failure.json', {
      reason: error instanceof Error ? error.message : 'Poll drain refused',
    });
  }
  if (settingAttempted && drained) {
    try {
      if (!linkListening) await reconnect();
      save('setting-restored.json', await state('restoreSetting'));
      expectedPolicy = baseline.offlinePolicy;
      settingRestored = true;
    } catch (error) {
      save('setting-manual-reconciliation.json', {
        reason: error instanceof Error ? error.message : 'Restoration refused',
      });
    }
  } else settingRestored = !settingAttempted;
  if (fixtureAttempted && (!drained || !settingRestored)) {
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
  const closes = await Promise.allSettled(participants.map((p) => p.browser.context.close()));
  const failures = closes
    .filter((result) => result.status === 'rejected')
    .map(() => 'Owned browser close failed');
  try {
    await link.close();
  } catch {
    failures.push('Owned link close failed');
  }
  save('owned-close.json', { failures });
  if (failures.length) captureError ||= 'Owned transport close failed';
  save('frames-final.json', {
    captureError,
    nativeCalls,
    participants: participants.map((p) => ({
      user: p.user,
      frames: p.frames,
      welcomes: p.welcomes,
    })),
  });
  if (createHash('sha256').update(readFileSync(paths.db)).digest('hex') !== originalDbHash)
    captureError = 'Original gateway database changed';
  save('original-db.json', {
    unchanged: createHash('sha256').update(readFileSync(paths.db)).digest('hex') === originalDbHash,
  });
  store.close();
}
if (!complete || !cleaned || !settingRestored || captureError)
  throw Error(`Task29 native incomplete; exact private evidence ${evidence}`);
console.log(
  `Task29 v${generation} COMPLETE ${run}; one fixture absent, original setting restored, isolated purge only, no native tool/audit writes; evidence ${evidence}`,
);
