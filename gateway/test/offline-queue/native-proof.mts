/* eslint-disable @typescript-eslint/no-explicit-any */
/** Opt-in only: importing this executable requires exact fresh consent; no auto approval. */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { parseLinkMessage, PROTOCOL_VERSION } from '@agent-gateway/protocol';
import { loadContext } from '../../../e2e/lib/context.js';
import { openUserBrowser, joinWorld, asJoinPage } from '../../../e2e/lib/browser.js';
import { LinkRegistry, LinkServer, PairingCodes } from '../../src/link/index.js';
import { EventBuffer } from '../../src/events/index.js';
import { toolsets } from '../../src/routing/index.js';
import { createSessionServer } from '../../src/mcp/session.js';
import { openStore } from '../../src/store/index.js';
import { OfflineQueue } from '../../src/offline-queue/service.js';
import { task28ReadPairings, task28Track, task28Drain } from '../events/native-plan.js';
import {
  TASK30_PINS,
  task30Plan,
  task30Receipt,
  task30Status,
  task30Attestation,
  task30SafePhase,
  task30AwaitPending,
  task30TeardownFailure,
} from './native-plan.js';
import { task30NativeState, task30PreloadTemplate } from './native-state.js';
const generation = Number(process.env.AGENT_GATEWAY_TASK30_GENERATION) as 13 | 14;
if (
  ![13, 14].includes(generation) ||
  process.env.AGENT_GATEWAY_TASK30_APPROVED !==
    'exact-private-actor-two-queued-updates-once-deny-and-cleanup'
)
  throw Error('Fresh exact Task30 consent required');
const root = fileURLToPath(new URL('../../../', import.meta.url)),
  { config, paths } = loadContext();
if (
  config.foundryOrigin !==
    (generation === 13 ? 'https://foundry13.local' : 'https://foundry.local') ||
  config.world !== 'test-world' ||
  config.linkPort !== (generation === 13 ? 7439 : 7429) ||
  !existsSync(paths.db)
)
  throw Error('Exact paired native target required');
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex'),
  bundle = readFileSync(resolve(root, 'dist/module/main.js')),
  template = readFileSync(resolve(root, 'templates/approval/approval.hbs')),
  locale = readFileSync(resolve(root, 'lang/en.json'));
if (
  sha(bundle) !== TASK30_PINS.bundle ||
  PROTOCOL_VERSION !== '6.0.0' ||
  execFileSync('git', ['rev-parse', `${TASK30_PINS.source}^{commit}`], {
    cwd: root,
    encoding: 'utf8',
  }).trim() !== TASK30_PINS.source ||
  execFileSync(
    'git',
    [
      'diff',
      TASK30_PINS.source,
      '--',
      'module/src',
      'protocol/src',
      'gateway/src',
      'templates',
      'lang/en.json',
    ],
    { cwd: root, encoding: 'utf8' },
  ).trim()
)
  throw Error('Reviewed protocol6 source/bundle changed');
const run = randomBytes(6).toString('hex'),
  evidence = resolve('/private/tmp', `task30-native-v${generation}-${run}`);
mkdirSync(evidence, { recursive: true, mode: 0o700 });
const save = (name: string, value: unknown) =>
    writeFileSync(resolve(evidence, name), JSON.stringify(value, null, 2), { mode: 0o600 }),
  originalDbHash = sha(readFileSync(paths.db)),
  imported = task28ReadPairings(paths.db, config.world),
  db = resolve(evidence, 'isolated.db');
let store = openStore(db),
  registry = new LinkRegistry(),
  events!: EventBuffer,
  queue!: OfflineQueue,
  link!: LinkServer;
for (const pair of imported) store.createPairing(pair);
function gateway() {
  events = new EventBuffer(store, registry);
  queue = new OfflineQueue(store, registry);
  link = new LinkServer({
    port: config.linkPort,
    store,
    registry,
    events,
    queue,
    codes: new PairingCodes(),
    allowedOrigins: [config.foundryOrigin],
    gatewayVersion: '0.1.0',
  });
}
gateway();
const pending = new Set<Promise<unknown>>(),
  clients: Client[] = [],
  calls: any[] = [],
  frames: any[] = [],
  ids: string[] = [];
let browser: Awaited<ReturnType<typeof openUserBrowser>> | undefined,
  baseline: any,
  plan: any,
  uuid = '',
  owner: any,
  complete = false,
  cleaned = false,
  listening = false,
  captureError = '',
  started = false;
let originalFailure: unknown;
let installedBundleHash = '';
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until(check: () => boolean | Promise<boolean>, ms = 15000) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw Error('Bounded native deadline');
    await delay(100);
  }
}
async function state(op: string, extra: Record<string, unknown> = {}) {
  if (!browser) throw Error('Native browser absent');
  return browser.page.evaluate(task30NativeState, {
    op,
    run,
    generation,
    baseline,
    plan,
    uuid,
    ids,
    ...extra,
  });
}
function live() {
  const c = registry.get(config.world, baseline.gm.id);
  if (
    captureError ||
    !c ||
    c.closed ||
    c.agentId !== owner.agentId ||
    !c.info.isGM ||
    !store.isPairingActive(c.agentId, c.worldId, c.userId) ||
    !toolsets.catalog(c)
  )
    throw Error('Exact native principal/catalog changed');
  return c;
}
async function session(userId: string) {
  const server = createSessionServer({
      version: '0.1.0',
      registry,
      events,
      queue,
      selector: { world: config.world, user: userId },
      knownIdentities: () =>
        store
          .listActivePairings()
          .map((p) => ({ worldId: p.worldId, userId: p.userId, userName: p.userName })),
      log() {},
    }),
    client = new Client({ name: 'task30-native', version: '0' }),
    [a, b] = InMemoryTransport.createLinkedPair();
  clients.push(client);
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
function request(client: Client, name: string, args: Record<string, unknown>) {
  return task28Track(
    pending,
    (async () => {
      const record: any = { name, args, terminal: false };
      calls.push(record);
      save('calls.json', calls);
      try {
        record.result = await client.callTool({ name, arguments: args });
        return record.result;
      } finally {
        record.terminal = true;
        save('calls.json', calls);
      }
    })(),
  );
}
async function status(client: Client, id: string, value: string) {
  const r = await request(client, 'approval_status', { id });
  if (r.isError) throw Error('Owner receipt read refused');
  return task30Status(r.structuredContent, id, value);
}
async function disconnect() {
  if (listening) {
    await link.close();
    listening = false;
  }
  await until(() => !registry.get(config.world, baseline.gm.id));
}
async function reconnect() {
  await link.listen();
  listening = true;
  await until(() => {
    const c = registry.get(config.world, baseline.gm.id);
    return !!c && !!toolsets.catalog(c);
  }, 45000);
  live();
}
async function dialog(id: string, index: number) {
  const article = browser!.page.locator(`article[data-request="${id}"]`);
  await article.waitFor({ timeout: 20000 });
  const args = JSON.parse(await article.locator('.ag-approval-payload').innerText());
  if (
    args.uuid !== uuid ||
    args.update !== JSON.stringify({ name: plan.names[index] }) ||
    (await article.locator('[data-action="session"]').count()) ||
    !(await article.innerText()).includes(plan.names[index])
  )
    throw Error('Exact replay arguments/once-only dialog missing');
  const rows = await state('queue'),
    r = rows.find((x: any) => x.id === id);
  if (!r?.replay || r.tool !== 'document_update' || r.status !== 'pending' || r.scope)
    throw Error('Canonical pending replay record missing');
  await browser!.page.bringToFront();
  await browser!.page.screenshot({ path: resolve(evidence, `dialog-${index}.png`) });
  save(`awaiting-${index}.json`, { id, args, record: r });
  process.stdout.write(
    `TASK30_AWAITING_${index === 0 ? 'APPROVE_ONCE' : 'DENY'} ${generation} ${id} ${plan.names[index]}\n`,
  );
}
try {
  await link.listen();
  listening = true;
  browser = await openUserBrowser(config, paths, config.gmUser, { headed: true });
  const installed = await browser.context.request.get(
    `${config.foundryOrigin}/modules/agent-gateway/dist/module/main.js`,
  );
  const installedBytes = await installed.body();
  if (!installed.ok() || installedBytes.length < 1 || installedBytes.length > 6000000)
    throw Error('Bounded installed production bundle unavailable');
  installedBundleHash = sha(installedBytes);
  let served = 0,
    sockets = 0;
  browser.page.on('websocket', (ws) => {
    if (new URL(ws.url()).port !== String(config.linkPort)) return;
    const socket = ++sockets;
    const capture = (direction: string, payload: string | Buffer) => {
      const p = parseLinkMessage(payload);
      if (!p.ok) {
        captureError = 'Invalid native frame';
        return;
      }
      if (['queuedCalls', 'queuedStatus', 'welcome', 'call'].includes(p.message.type)) {
        if (frames.length >= 200) {
          captureError = 'Native capture bound';
          return;
        }
        frames.push({ socket, direction, message: p.message });
        save('frames.json', frames);
      }
    };
    ws.on('framesent', ({ payload }) => capture('framesent', payload));
    ws.on('framereceived', ({ payload }) => capture('framereceived', payload));
  });
  await browser.context.route('**/modules/agent-gateway/dist/module/main.js*', async (route) => {
    if (sha(readFileSync(resolve(root, 'dist/module/main.js'))) !== TASK30_PINS.bundle)
      throw Error('Bundle changed');
    served++;
    await route.fulfill({ body: bundle, contentType: 'text/javascript' });
  });
  await browser.context.route(
    '**/modules/agent-gateway/templates/approval/approval.hbs*',
    (route) => route.fulfill({ body: template, contentType: 'text/plain' }),
  );
  await browser.context.route('**/modules/agent-gateway/lang/en.json*', (route) =>
    route.fulfill({ body: locale, contentType: 'application/json' }),
  );
  await joinWorld(asJoinPage(browser.page), config, config.gmUser);
  await browser.page.waitForFunction('game.ready && !canvas.loading');
  if (!served) throw Error('Reviewed bundle was not served');
  baseline = await state('baseline');
  const pairs = imported.filter((p) => p.userName === config.gmUser && p.userId === baseline.gm.id);
  if (pairs.length !== 1 || baseline.gm.name !== config.gmUser)
    throw Error('Exact configured paired GM required');
  owner = { worldId: config.world, userId: baseline.gm.id, agentId: pairs[0]!.id };
  await until(() => {
    const c = registry.get(owner.worldId, owner.userId);
    return !!c && !!toolsets.catalog(c);
  });
  if (
    !toolsets.catalog(live())!.some((t) => t.name === 'document_update' && t.category === 'write')
  )
    throw Error('Current native policy does not admit fixture write');
  await browser.page.evaluate(task30PreloadTemplate, template.toString('utf8'));
  const other = imported.find((p) => p.userId !== owner.userId);
  if (!other) throw Error('Second existing pairing required before any writes');
  plan = task30Plan(run, baseline.gm.id);
  const initial = await session(owner.userId);
  const tools = await initial.listTools();
  save('baseline.json', {
    ...TASK30_PINS,
    installedBundleHash,
    template: sha(template),
    locale: sha(locale),
    run,
    plan,
    baseline,
    tools,
  });
  started = true;
  const made = await state('create');
  uuid = made.uuid;
  save('created.json', made);
  await disconnect();
  const read = await request(initial, 'document_get', { uuid });
  if (!read.isError || !JSON.stringify(read.content).includes('WORLD_OFFLINE'))
    throw Error('Offline read must refuse without queueing');
  for (let index = 0; index < 2; index++) {
    const result = await request(initial, 'document_update', {
      uuid,
      update: JSON.stringify({ name: plan.names[index] }),
    });
    if (result.isError) throw Error('Offline write was not queued');
    ids.push(task30Receipt(result.structuredContent));
    await status(initial, ids[index]!, 'queued');
  }
  if (new Set(ids).size !== 2 || store.queue.queued(owner, 20).length !== 2)
    throw Error('Exact two queued intents required');
  await initial.close();
  queue.close();
  events.close();
  store.close();
  store = openStore(db);
  registry = new LinkRegistry();
  gateway();
  const fresh = await session(owner.userId);
  for (const id of ids) await status(fresh, id, 'queued');
  save('reopened.json', {
    ids,
    rows: ids.map((id) => store.queue.get(owner, id)),
    list: await fresh.listTools(),
  });
  const stranger = await session(other.userId),
    privateResult = await request(stranger, 'approval_status', { id: ids[0]! });
  if (!privateResult.isError || JSON.stringify(privateResult).includes(plan.names[0]))
    throw Error('Cross-owner queued receipt exposed');
  await stranger.close();
  await reconnect();
  await task30AwaitPending(
    () => ids.every((id) => store.queue.get(owner, id)?.state === 'pending'),
    { now: Date.now, sleep: delay },
  );
  await dialog(ids[0]!, 0);
  await until(() => store.queue.get(owner, ids[0]!)?.state === 'approved', 300000);
  const approvedStatus: any = await status(fresh, ids[0]!, 'approved');
  if (approvedStatus.resultFailed !== false)
    throw Error('Successful queued execution flag missing');
  if ((await state('facts')).name !== plan.names[0]) throw Error('Approved native rename missing');
  await dialog(ids[1]!, 1);
  await until(() => store.queue.get(owner, ids[1]!)?.state === 'denied', 300000);
  const denied: any = await status(fresh, ids[1]!, 'denied');
  // Gateway receipt reason is its text result; native record retains exact human reason.
  const records = await state('queue');
  task30Attestation(records, ids, baseline.gm.name, plan.denialReason, denied.result);
  if (!JSON.stringify(denied).includes(plan.denialReason))
    throw Error('Gateway denial reason missing');
  let audits: any[] = [];
  await until(async () => {
    audits = await state('audits');
    return audits.length > 0;
  });
  if (
    audits.length !== 1 ||
    audits[0].tool !== 'document_update' ||
    audits[0].userId !== owner.userId ||
    audits[0].agentId !== owner.agentId ||
    audits[0].status !== 'ok' ||
    audits[0].category !== 'write' ||
    audits[0].targets.length !== 1 ||
    audits[0].targets[0].uuid !== uuid ||
    audits[0].argsTruncated ||
    JSON.parse(audits[0].args).update !== JSON.stringify({ name: plan.names[0] })
  )
    throw Error('Exact single native mutation audit missing');
  const before = await state('facts'),
    deliveries = frames.filter((f) => f.message.type === 'queuedCalls'),
    original = deliveries.flatMap((f) => f.message.calls);
  if (
    original.length !== 2 ||
    new Set(original.map((c: any) => c.id)).size !== 2 ||
    original.some((c: any) => !ids.includes(c.id) || c.args.uuid !== uuid)
  )
    throw Error('Exact original replay delivery missing');
  const statusCount = frames.filter((f) => f.message.type === 'queuedStatus').length;
  live().send(JSON.stringify({ type: 'queuedCalls', calls: original }));
  await until(
    () => frames.filter((f) => f.message.type === 'queuedStatus').length >= statusCount + 2,
  );
  if (
    JSON.stringify(await state('facts')) !== JSON.stringify(before) ||
    JSON.stringify(await state('audits')) !== JSON.stringify(audits)
  )
    throw Error('Duplicate replay mutated or audited again');
  const deliveryCount = frames.filter((f) => f.message.type === 'queuedCalls').length;
  await disconnect();
  await reconnect();
  await delay(500);
  for (let index = 0; index < 2; index++)
    await status(fresh, ids[index]!, index === 0 ? 'approved' : 'denied');
  if (
    frames.filter((f) => f.message.type === 'queuedCalls').length !== deliveryCount ||
    frames.some((f) => f.message.type === 'call') ||
    JSON.stringify(await state('facts')) !== JSON.stringify(before) ||
    JSON.stringify(await state('audits')) !== JSON.stringify(audits) ||
    captureError
  )
    throw Error('Reconnect redelivered terminal queue or changed fixture/audit');
  save('acceptance.json', {
    ids,
    records,
    audits,
    denied,
    before,
    after: await state('facts'),
    automaticOnly: [
      'forced-under-allow/session-grant',
      'TTL/caps',
      'claimed-crash-unknown',
      'source/definition/policy tightening',
    ],
  });
  await task28Drain(clients, pending);
  save('cleanup.json', await state('cleanup'));
  cleaned = true;
  complete = true;
} catch (error) {
  originalFailure = error;
  save('failure.json', {
    message: String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  throw error;
} finally {
  const teardownErrors: string[] = [];
  const safely = (label: string, op: () => unknown | Promise<unknown>) =>
    task30SafePhase(teardownErrors, label, op);
  // Each teardown phase is independent; a drain timeout cannot leave owned sockets/timers alive.
  await safely('clients', () => Promise.allSettled(clients.map((c) => c.close())));
  await safely('link', async () => {
    if (listening) {
      await link.close();
      listening = false;
    }
  });
  let drained = false;
  await safely('drain', async () => {
    await task28Drain(clients, pending);
    drained = true;
  });
  if (started && !cleaned && browser) {
    let candidate: unknown;
    await safely('candidate-read', async () => {
      candidate = await state('createdCandidate');
    });
    if (uuid && drained)
      await safely('fixture-cleanup', async () => {
        save('cleanup-failure.json', await state('cleanup'));
        cleaned = true;
      });
    if (!cleaned)
      save('manual-reconciliation.json', { run, uuid, ids, candidate, plan, teardownErrors });
  }
  await safely('browser', () => browser?.context.close());
  await safely('queue', () => queue.close());
  await safely('events', () => events.close());
  await safely('store', () => store.close());
  await safely('original-db', () => {
    if (sha(readFileSync(paths.db)) !== originalDbHash)
      throw Error('Original credential database changed');
  });
  save('result.json', {
    complete,
    cleaned,
    teardownErrors,
    source: TASK30_PINS.source,
    protocol: PROTOCOL_VERSION,
  });
  process.stdout.write(
    `TASK30_RESULT ${JSON.stringify({ complete, cleaned, evidence, teardownErrors })}\n`,
  );
  task30TeardownFailure(originalFailure, teardownErrors);
}
