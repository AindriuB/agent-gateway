/* eslint-disable @typescript-eslint/no-explicit-any */
/** Explicitly opted-in generic adapter plumbing only. Never clicks human approval controls. */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { PROTOCOL_VERSION, parseLinkMessage } from '@agent-gateway/protocol';
import { loadContext } from '../../../../e2e/lib/context.js';
import { openUserBrowser, joinWorld, asJoinPage } from '../../../../e2e/lib/browser.js';
import { LinkRegistry, LinkServer, PairingCodes } from '../../../../gateway/src/link/index.js';
import { openStore } from '../../../../gateway/src/store/index.js';
import { EventBuffer } from '../../../../gateway/src/events/index.js';
import { OfflineQueue } from '../../../../gateway/src/offline-queue/service.js';
import { toolsets } from '../../../../gateway/src/routing/index.js';
import { createSessionServer } from '../../../../gateway/src/mcp/session.js';
import {
  task28ReadPairings,
  task28Track,
  task28Drain,
} from '../../../../gateway/test/events/native-plan.js';
import {
  task30SafePhase,
  task30TeardownFailure,
} from '../../../../gateway/test/offline-queue/native-plan.js';
import { waitForNativeApprovals } from '../../tools/player-tokens-combat/native-approval.js';
import {
  TASK31_NATIVE_PINS,
  task31NativePlan,
  task31ReadResult,
  task31OnceRecord,
  task31AuditRows,
  task31CleanupReady,
} from './native-plan.js';
import { validateSnapshot } from '../../../src/policy/snapshot.js';
import { task31NativeState, task31PreloadTemplate } from './native-state.js';
const generation = Number(process.env.AGENT_GATEWAY_TASK31_GENERATION) as 13 | 14;
if (
  ![13, 14].includes(generation) ||
  process.env.AGENT_GATEWAY_TASK31_APPROVED !==
    'exact-private-npc-six-generic-calls-two-once-approvals-and-cleanup'
)
  throw Error('Fresh exact Task31 consent required');
const root = fileURLToPath(new URL('../../../../', import.meta.url)),
  { config, paths } = loadContext();
if (
  config.foundryOrigin !==
    (generation === 13 ? 'https://foundry13.local' : 'https://foundry.local') ||
  config.world !== 'test-world' ||
  config.linkPort !== (generation === 13 ? 7439 : 7429) ||
  !existsSync(paths.db)
)
  throw Error('Exact paired native target required');
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex'),
  bundle = readFileSync(resolve(root, 'dist/module/main.js')),
  template = readFileSync(resolve(root, 'templates/approval/approval.hbs')),
  locale = readFileSync(resolve(root, 'lang/en.json'));
if (
  sha(bundle) !== TASK31_NATIVE_PINS.bundle ||
  PROTOCOL_VERSION !== '6.0.0' ||
  execFileSync(
    'git',
    [
      'diff',
      TASK31_NATIVE_PINS.source,
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
  throw Error('Reviewed Task31 source/bundle changed');
const run = randomBytes(6).toString('hex'),
  evidence = resolve('/private/tmp', `task31-native-v${generation}-${run}`);
mkdirSync(evidence, { recursive: true, mode: 0o700 });
const save = (name: string, value: unknown) =>
  writeFileSync(resolve(evidence, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const originalDbHash = sha(readFileSync(paths.db)),
  imported = task28ReadPairings(paths.db, config.world),
  store = openStore(resolve(evidence, 'isolated.db')),
  registry = new LinkRegistry();
for (const pair of imported) store.createPairing(pair);
const events = new EventBuffer(store, registry),
  queue = new OfflineQueue(store, registry),
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
const pending = new Set<Promise<unknown>>(),
  calls: any[] = [],
  ids: string[] = [],
  frames: any[] = [];
let browser: Awaited<ReturnType<typeof openUserBrowser>> | undefined,
  client: Client | undefined,
  baseline: any,
  plan: any,
  created: any,
  owner: any,
  uuid = '',
  connectionId = '',
  complete = false,
  cleaned = false,
  listening = false,
  started = false,
  captureError = '',
  originalFailure: unknown;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until(check: () => boolean | Promise<boolean>, ms = 20000) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw Error('Bounded Task31 native deadline');
    await delay(100);
  }
}
async function state(op: string) {
  if (!browser) throw Error('Native browser absent');
  return browser.page.evaluate(task31NativeState, {
    op,
    run,
    generation,
    baseline,
    plan,
    uuid,
    ids,
  });
}
function live() {
  const c = registry.get(config.world, baseline.gm.id);
  if (
    captureError ||
    !c ||
    c.closed ||
    !c.info.isGM ||
    c.agentId !== owner.agentId ||
    !store.isPairingActive(c.agentId, c.worldId, c.userId) ||
    (connectionId && c.id !== connectionId) ||
    !toolsets.catalog(c)
  )
    throw Error('Pinned native principal/catalog changed');
  return c;
}
function request(spec: any) {
  live();
  const record: any = { ...spec, terminal: false };
  calls.push(record);
  save('calls.json', calls);
  const result = task28Track(
    pending,
    (async () => {
      try {
        record.result = await client!.callTool({ name: spec.name, arguments: spec.args });
        return record.result;
      } finally {
        record.terminal = true;
        save('calls.json', calls);
      }
    })(),
  );
  return result;
}
try {
  await link.listen();
  listening = true;
  browser = await openUserBrowser(config, paths, config.gmUser, { headed: true });
  // Permit only the exact Foundry native transport and this isolated localhost gateway.
  await browser.context.routeWebSocket(
    (url) =>
      !(
        (url.origin === config.foundryOrigin.replace(/^https:/, 'wss:') &&
          /^\/socket.io\/?$/.test(url.pathname)) ||
        (url.protocol === 'ws:' &&
          ['localhost', '127.0.0.1'].includes(url.hostname) &&
          url.port === String(config.linkPort) &&
          url.pathname === '/')
      ),
    (route) => route.close(),
  );
  const installed = await browser.context.request.get(
      `${config.foundryOrigin}/modules/agent-gateway/dist/module/main.js`,
      { ignoreHTTPSErrors: true },
    ),
    installedBytes = await installed.body();
  if (!installed.ok() || !installedBytes.length || installedBytes.length > 6000000)
    throw Error('Bounded installed bundle required');
  let served = 0;
  await browser.context.route('**/modules/agent-gateway/dist/module/main.js*', (route) => {
    if (sha(readFileSync(resolve(root, 'dist/module/main.js'))) !== TASK31_NATIVE_PINS.bundle)
      throw Error('Bundle changed');
    served++;
    return route.fulfill({ body: bundle, contentType: 'text/javascript' });
  });
  await browser.context.route(
    '**/modules/agent-gateway/templates/approval/approval.hbs*',
    (route) => route.fulfill({ body: template, contentType: 'text/plain' }),
  );
  await browser.context.route('**/modules/agent-gateway/lang/en.json*', (route) =>
    route.fulfill({ body: locale, contentType: 'application/json' }),
  );
  browser.page.on('websocket', (ws) => {
    if (new URL(ws.url()).port !== String(config.linkPort)) return;
    const capture = (direction: string, payload: string | Buffer) => {
      const parsed = parseLinkMessage(payload);
      if (!parsed.ok) {
        captureError = 'Invalid native frame';
        return;
      }
      if (
        ['call', 'result', 'error', 'welcome', 'queuedCalls', 'queuedStatus'].includes(
          parsed.message.type,
        )
      ) {
        if (frames.length >= 100) {
          captureError = 'Frame cap';
          return;
        }
        frames.push({ direction, message: parsed.message });
        save('frames.json', frames);
      }
    };
    ws.on('framesent', ({ payload }) => capture('sent', payload));
    ws.on('framereceived', ({ payload }) => capture('received', payload));
  });
  await joinWorld(asJoinPage(browser.page), config, config.gmUser);
  await browser.page.waitForFunction('game.ready && !canvas.loading');
  if (!served) throw Error('Reviewed bundle was not served');
  baseline = await state('baseline');
  const pair = imported.filter((p) => p.userName === config.gmUser && p.userId === baseline.gm.id);
  if (pair.length !== 1 || baseline.gm.name !== config.gmUser)
    throw Error('Exact paired canonical GM required');
  owner = { agentId: pair[0]!.id };
  await until(
    () =>
      !!registry.get(config.world, baseline.gm.id) &&
      !!toolsets.catalog(registry.get(config.world, baseline.gm.id)!),
  );
  connectionId = live().id;
  validateSnapshot(baseline.policySnapshot);
  const catalog = toolsets.catalog(live())!;
  if (
    ['actor_summary', 'actions_list', 'inventory', 'conditions', 'action_perform'].some(
      (name) => !catalog.some((t) => t.name === name),
    )
  )
    throw Error('Actual policy does not announce all five adapter tools');
  await browser.page.evaluate(task31PreloadTemplate, template.toString('utf8'));
  const server = createSessionServer({
      version: '0.1.0',
      registry,
      events,
      queue,
      selector: { world: config.world, user: baseline.gm.id },
      knownIdentities: () =>
        store
          .listActivePairings()
          .map((p) => ({ worldId: p.worldId, userId: p.userId, userName: p.userName })),
      log() {},
    }),
    [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'task31-native', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const listed = await client.listTools();
  if (
    ['actor_summary', 'actions_list', 'inventory', 'conditions', 'action_perform'].some(
      (name) => !listed.tools.some((t) => t.name === name),
    )
  )
    throw Error('Native SDK tools absent');
  plan = task31NativePlan(run, baseline.gm.id);
  save('baseline.json', {
    ...TASK31_NATIVE_PINS,
    installedBundleHash: sha(installedBytes),
    template: sha(template),
    locale: sha(locale),
    run,
    plan,
    baseline,
    tools: listed.tools,
  });
  started = true;
  created = await state('create');
  uuid = created.uuid;
  plan = task31NativePlan(run, baseline.gm.id, uuid);
  save('created.json', created);
  save('plan.json', plan);
  const before = await state('facts');
  for (let i = 0; i < 4; i++) {
    const result = await request(plan.calls[i]);
    task31ReadResult(i, result, created);
    if (JSON.stringify(await state('facts')) !== JSON.stringify(before))
      throw Error('Read changed fixture');
    if ((await state('audits')).length) throw Error('Read generated a mutation audit');
  }
  const records: any[] = [];
  for (let i = 4; i < 6; i++) {
    const spec = plan.calls[i],
      operation = request(spec);
    await waitForNativeApprovals(browser.page, 1);
    const article = browser.page.locator('article[data-request]');
    const id = await article.getAttribute('data-request');
    if (!id || ids.includes(id)) throw Error('Exact fresh native approval required');
    ids.push(id);
    const args = JSON.parse(await article.locator('.ag-approval-payload').innerText());
    if (JSON.stringify(args) !== JSON.stringify(spec.args))
      throw Error('Native reviewed arguments differ');
    const row = (await state('queue')).find((r: any) => r.id === id);
    if (
      !row ||
      row.status !== 'pending' ||
      row.tool !== spec.name ||
      row.category !== 'write' ||
      row.approver !== 'owner' ||
      row.agentId !== owner.agentId ||
      row.scope
    )
      throw Error('Exact pending native write approval absent');
    await browser.page.bringToFront();
    await browser.page.screenshot({ path: resolve(evidence, `dialog-${i - 4}.png`) });
    save(`awaiting-${i - 4}.json`, { id, spec, row });
    process.stdout.write(`TASK31_AWAITING_APPROVE_ONCE ${generation} ${id} ${spec.name}\n`);
    let settled: any;
    await until(async () => {
      settled = (await state('queue')).find((r: any) => r.id === id);
      return !!settled?.result;
    }, 300000);
    task31OnceRecord(settled, spec, baseline.gm.name, owner.agentId);
    records.push(settled);
    const result: any = await operation;
    if (result.structuredContent?.status === 'pending_approval') {
      if (result.structuredContent.id !== id) throw Error('Delayed receipt mismatch');
    } else if (result.isError !== true || !JSON.stringify(result.content).includes('INVALID_ARGS'))
      throw Error('Unsupported SDK result missing');
    if (JSON.stringify(await state('facts')) !== JSON.stringify(before))
      throw Error('Unsupported call changed fixture');
    await until(async () => (await state('audits')).length === i - 3);
  }
  const audits = task31AuditRows(
    await state('audits'),
    plan,
    created,
    baseline.gm.id,
    owner.agentId,
  );
  if (
    captureError ||
    calls.length !== 6 ||
    calls.some((c) => !c.terminal) ||
    frames.some((f) => f.message.type === 'queuedCalls')
  )
    throw Error('Native isolated call capture mismatch');
  save('acceptance.json', {
    records,
    audits,
    before,
    after: await state('facts'),
    limits: [
      'GM generic plumbing only',
      'No concrete PF2e semantics',
      'No player ownership/privacy claim',
    ],
  });
  await task28Drain([client], pending);
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
  const errors: string[] = [];
  const safely = (label: string, op: () => unknown | Promise<unknown>) =>
    task30SafePhase(errors, label, op);
  // Exact cleanup only when all native approval continuations have settled; otherwise close/fence and record custody.
  if (started && !cleaned && browser) {
    await safely('candidate', async () => {
      const candidate = await state('createdCandidate');
      save('candidate.json', candidate);
    });
    if (uuid && task31CleanupReady(pending.size, calls))
      await safely('fixture-cleanup', async () => {
        save('cleanup-failure.json', await state('cleanup'));
        cleaned = true;
      });
    if (!cleaned) save('manual-reconciliation.json', { uuid, ids, run, plan, created });
  }
  await safely('browser', () => browser?.context.close());
  await safely('client', () => client?.close());
  await safely('link', async () => {
    if (listening) {
      await link.close();
      listening = false;
    }
  });
  await safely('drain', () => task28Drain(client ? [client] : [], pending));
  await safely('queue', () => queue.close());
  await safely('events', () => events.close());
  await safely('store', () => store.close());
  await safely('original-db', () => {
    if (sha(readFileSync(paths.db)) !== originalDbHash)
      throw Error('Production credential database changed');
  });
  save('result.json', {
    complete,
    cleaned,
    teardownErrors: errors,
    source: TASK31_NATIVE_PINS.source,
    protocol: PROTOCOL_VERSION,
  });
  task30TeardownFailure(originalFailure, errors);
}
process.stdout.write(`TASK31_RESULT ${JSON.stringify({ complete, cleaned, evidence })}\n`);
