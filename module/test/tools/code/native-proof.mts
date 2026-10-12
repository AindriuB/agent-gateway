/* eslint-disable @typescript-eslint/no-explicit-any */
/** Opt-in Task26 native acceptance executor. No automated approval/denial clicks. Never run without exact human consent. */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadContext } from '../../../../e2e/lib/context.js';
import { openUserBrowser, joinWorld, asJoinPage } from '../../../../e2e/lib/browser.js';
import { LinkRegistry, LinkServer, PairingCodes } from '../../../../gateway/src/link/index.js';
import { toolsets } from '../../../../gateway/src/routing/index.js';
import { createSessionServer } from '../../../../gateway/src/mcp/session.js';
import { openStore } from '../../../../gateway/src/store/index.js';
import { readNativeWritePolicy } from '../player-writes/live-policy.js';
import { waitForNativeApprovals } from '../player-tokens-combat/native-approval.js';
import { prepareNativeCleanup } from '../gm-documents/native-lifecycle.js';
import { freshCallAudit, capturedCallAudit, type NativeCall } from '../gm-scene/native-plan.js';
import { assertTask24Terminal, assertTask24Decision } from '../gm-scene/native-lifecycle.js';
import {
  task26Plan,
  task26ProofPins,
  assertTask26SourceCard,
  assertTask26Return,
} from './native-plan.js';
import { task26NativeState } from './native-state.js';
const { source: task26Source, bundle: task26Bundle } = task26ProofPins(
  process.env.AGENT_GATEWAY_TASK26_SOURCE,
  process.env.AGENT_GATEWAY_TASK26_BUNDLE,
);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const generation = Number(process.env.AGENT_GATEWAY_TASK26_GENERATION);
if (
  ![13, 14].includes(generation) ||
  process.env.AGENT_GATEWAY_TASK26_APPROVED !== 'exact-fixtures-and-cleanup'
)
  throw Error('Exact Task26 fixture and cleanup consent required');
const { config, paths } = loadContext();
if (
  new URL(config.foundryOrigin).hostname !==
  (generation === 13 ? 'foundry13.local' : 'foundry.local')
)
  throw Error('Exact test host required');
if (!existsSync(paths.db)) throw Error('Existing paired database required');
if (config.world !== 'test-world' || config.linkPort !== (generation === 13 ? 7439 : 7429))
  throw Error('Exact test-world and generation-specific native link port required');
const run = randomBytes(6).toString('hex'),
  evidence = resolve('/private/tmp', `task26-native-v${generation}-${run}`);
mkdirSync(evidence, { recursive: true });
const bundle = readFileSync(resolve(root, 'dist/module/main.js')),
  hash = createHash('sha256').update(bundle).digest('hex');
if (hash !== task26Bundle) throw Error('Reviewed source bundle mismatch');
const save = (name: string, value: unknown) =>
  writeFileSync(resolve(evidence, name), JSON.stringify(value, null, 2));
const store = openStore(paths.db),
  registry = new LinkRegistry(),
  link = new LinkServer({
    port: config.linkPort,
    store,
    registry,
    codes: new PairingCodes(),
    allowedOrigins: [config.foundryOrigin],
    gatewayVersion: '0.1.0',
  });
let browser: Awaited<ReturnType<typeof openUserBrowser>> | undefined,
  client: Client | undefined,
  server: ReturnType<typeof createSessionServer> | undefined,
  baseline: any,
  principal: any,
  pinnedConnectionId = '';
const audits: string[] = [],
  outstanding: Promise<unknown>[] = [];
let uuid = '',
  complete = false,
  cleaned = false,
  fixtureAttempted = false;
function livePrincipal() {
  if (!principal) throw Error('Pinned native principal unavailable');
  const c = registry.get(principal.worldId, principal.userId),
    tools = c ? toolsets.get(c) : undefined;
  if (
    !c ||
    c.closed ||
    !c.info.isGM ||
    c.agentId !== principal.agentId ||
    c.worldId !== principal.worldId ||
    c.userId !== principal.userId ||
    (pinnedConnectionId && c.id !== pinnedConnectionId) ||
    !tools ||
    ['macro_run', 'script_run'].some((name) => !tools.some((t) => t.name === name))
  )
    throw Error('Authenticated exact live principal/tool announcement unavailable');
  return c;
}
async function state(op: string, extra: Record<string, unknown> = {}) {
  return browser!.page.evaluate(task26NativeState, {
    op,
    generation,
    run,
    baseline,
    source: task26Plan(run, generation).fixture,
    uuid,
    ...extra,
  });
}
async function auditRows() {
  return state('audits');
}
type Dispatched = {
  spec: NativeCall;
  baseline: string[];
  terminal: boolean;
  denied: boolean;
  approvalId?: string;
  audit?: { uuid: string; entryId: string };
};
const dispatched: Dispatched[] = [];
async function nativeCall(record: Dispatched, publicArgs: Record<string, unknown>) {
  const { spec } = record;
  livePrincipal();
  const result = await client!.callTool({ name: spec.tool, arguments: publicArgs });
  save(`sdk-immediate-${dispatched.indexOf(record) + 1}.json`, { spec, result });
  let failed = result.isError === true,
    text = (result.content as any[])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
  let structured = result.structuredContent as any;
  const pendingCompletion = structured?.status === 'pending_approval';
  if (structured?.status === 'pending_approval') {
    console.log(`[task26] PENDING v${generation} ${spec.tool} idPresent=true`);
    const id = structured.id;
    for (let i = 0; i < 600; i++) {
      const polled = await client!.callTool({ name: 'approval_status', arguments: { id } });
      const status = polled.structuredContent as any;
      if (polled.isError) throw Error('Approval status lookup failed');
      if (status?.status === 'expired')
        throw Error('Approval expired; human denial was not proven');
      if (status?.status === 'denied') {
        failed = true;
        record.denied = true;
        text = `DENIED: ${status.status}`;
        structured = undefined;
        break;
      }
      if (status?.result !== undefined) {
        failed = status.resultFailed === true;
        text = status.result;
        structured = undefined;
        break;
      }
      if (i === 599) throw Error('Bounded human approval deadline exceeded');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  record.terminal = true;
  save(`sdk-terminal-${dispatched.indexOf(record) + 1}.json`, {
    spec,
    failed,
    text,
    structured,
    pendingCompletion,
  });
  if (spec.expected === 'ok' ? failed : !failed || !text.includes(spec.expected))
    throw Error(`Unexpected native result for ${spec.tool}: ${text}`);
  return { failed, text, structured, pending: pendingCompletion };
}
async function step(index: number) {
  livePrincipal();
  await state('facts');
  const planned = task26Plan(run, generation, uuid).calls[index]!;
  const spec: NativeCall = {
    tool: planned.tool,
    args: planned.tool === 'macro_run' ? { ...planned.args, source: planned.source } : planned.args,
    expected: 'ok',
    audit: true,
  };
  const record: Dispatched = {
    spec,
    baseline: (await auditRows()).map((r: any) => r.uuid),
    terminal: false,
    denied: false,
  };
  dispatched.push(record);
  // Public MCP args never include internally enriched Macro source.
  const operation = nativeCall(record, planned.args).catch((error) => {
    save(`sdk-error-${index + 1}.json`, { message: String(error) });
    throw error;
  });
  outstanding.push(
    operation.then(
      () => undefined,
      () => undefined,
    ),
  );
  await waitForNativeApprovals(browser!.page, 1);
  const cards = await browser!.page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('article[data-request]')].map((card) => ({
      id: card.dataset.request!,
      tool: card.querySelector('h3')?.textContent?.trim() ?? '',
      args: JSON.parse(card.querySelector('.ag-approval-payload')?.textContent ?? 'null'),
      source: card.querySelector('.ag-approval-code')?.textContent ?? '',
      session: !!card.querySelector('[data-action="session"]'),
    })),
  );
  if (cards.length !== 1) throw Error('Exact one code approval required');
  assertTask26SourceCard(cards[0]!, planned);
  record.approvalId = cards[0]!.id;
  save(`approval-${index + 1}.json`, {
    cards,
    sourceSHA: createHash('sha256').update(cards[0]!.source).digest('hex'),
  });
  await browser!.page.bringToFront();
  await browser!.page.screenshot({ path: resolve(evidence, `approval-${index + 1}.png`) });
  console.log(
    `[task26] READY v${generation} step=${index + 1}/2 tool=${spec.tool} fullSourceVerified=true human=APPROVE_ONCE`,
  );
  const result = await operation;
  const queue = await state('queue'),
    approval = queue.find((r: any) => r.id === record.approvalId);
  save(`terminal-${index + 1}.json`, { spec, result, approval });
  assertTask24Decision(approval, baseline.gm.name, false);
  let audit: any;
  for (let n = 0; ; n++) {
    try {
      audit = freshCallAudit(
        await auditRows(),
        record.baseline,
        { userId: baseline.gm.id, agentId: principal.agentId },
        spec,
      );
      break;
    } catch (error) {
      if (n === 100) throw error;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  record.audit = { uuid: audit.uuid, entryId: audit.entryId };
  audits.push(audit.uuid);
  save(`audit-${index + 1}.json`, audit);
  const facts = await state('facts');
  save(`result-${index + 1}.json`, { result, audit, approval, facts });
  if (audit.category !== 'code' || audit.status !== 'ok' || audit.targets.length !== 0)
    throw Error('Exact read-only code audit mismatch');
  assertTask26Return(result, planned.expected);
  console.log(
    `[task26] RESULT v${generation} step=${index + 1}/2 codeAudit=true pendingTextOnly=${result.pending}`,
  );
}
async function open(name: string) {
  const b = await openUserBrowser(config, paths, name, { headed: true });
  try {
    let served = 0;
    await b.context.route('**/modules/agent-gateway/dist/module/main.js*', async (route) => {
      const current = readFileSync(resolve(root, 'dist/module/main.js'));
      if (createHash('sha256').update(current).digest('hex') !== hash)
        throw Error('Routed bundle changed');
      await route.fulfill({ body: current, contentType: 'text/javascript' });
      served++;
    });
    for (const [pattern, path, contentType] of [
      ['**/modules/agent-gateway/lang/en.json*', 'lang/en.json', 'application/json'],
      [
        '**/modules/agent-gateway/styles/agent-gateway.css*',
        'styles/agent-gateway.css',
        'text/css',
      ],
    ])
      await b.context.route(pattern!, (route) =>
        route.fulfill({ path: resolve(root, path!), contentType }),
      );
    await joinWorld(asJoinPage(b.page), config, name);
    if (!served) throw Error('Exact routed bundle not observed');
    return b;
  } catch (error) {
    await b.context.close();
    throw error;
  }
}
try {
  await link.listen();
  browser = await open(config.gmUser);
  const rawPolicy = await browser.page.evaluate(() =>
    (globalThis as any).game.settings.get('agent-gateway', 'worldPolicy'),
  );
  if (readNativeWritePolicy(rawPolicy).gm !== 'ask_owner')
    throw Error('Real human once approval policy required');
  baseline = await state('baseline', {});
  save('baseline.json', { source: task26Source, bundle: hash, run, baseline });
  const pairs = store
    .listActivePairings()
    .filter((p) => p.worldId === config.world && p.userId === baseline.gm.id);
  if (pairs.length !== 1) throw Error('Unique GM pairing required');
  principal = { worldId: config.world, userId: baseline.gm.id, agentId: pairs[0]!.id };
  const gateway = await browser.page.evaluate(() =>
      String((globalThis as any).game.settings.get('agent-gateway', 'gatewayUrl')),
    ),
    url = new URL(gateway);
  if (!['ws:', 'wss:'].includes(url.protocol) || Number(url.port) !== config.linkPort)
    throw Error('Native gateway port mismatch');
  for (let n = 0; ; n++) {
    try {
      livePrincipal();
      break;
    } catch (error) {
      if (n === 100) throw error;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  pinnedConnectionId = livePrincipal().id;
  save('principal.json', { ...principal, connectionId: pinnedConnectionId });
  await browser.page.evaluate(
    ({ source, path }) => {
      const h = (globalThis as any).Handlebars;
      h.registerPartial(path, h.compile(source));
    },
    {
      source: readFileSync(resolve(root, 'templates/approval/approval.hbs'), 'utf8'),
      path: 'modules/agent-gateway/templates/approval/approval.hbs',
    },
  );
  server = createSessionServer({
    version: '0.1.0',
    registry,
    selector: { world: config.world, user: principal.userId },
    knownIdentities: () =>
      store
        .listActivePairings()
        .map((p) => ({ worldId: p.worldId, userId: p.userId, userName: p.userName })),
    log: () => {},
  });
  client = new Client({ name: 'task26-native', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  const listed = await client.listTools();
  if (['macro_run', 'script_run'].some((name) => !listed.tools.some((t) => t.name === name)))
    throw Error('Exact tools not announced');
  livePrincipal();
  fixtureAttempted = true;
  const made = await state('create');
  uuid = made.uuid;
  save('fixture.json', made);
  await step(0);
  await step(1);
  complete = true;
} catch (error) {
  save('failure.json', { message: String(error), uuid, audits });
  throw error;
} finally {
  try {
    if (browser && baseline && fixtureAttempted)
      await prepareNativeCleanup({
        baselineCaptured: true,
        settle: async () => {
          await Promise.all(outstanding);
        },
        drain: async () => {
          if (dispatched.some((r) => !r.terminal))
            throw Error('Unproven terminal execution: manual reconciliation required');
          for (const record of dispatched) {
            const row: any = record.audit
              ? capturedCallAudit(
                  await auditRows(),
                  record.baseline,
                  { userId: baseline.gm.id, agentId: principal.agentId },
                  record.spec,
                  record.audit,
                )
              : freshCallAudit(
                  await auditRows(),
                  record.baseline,
                  { userId: baseline.gm.id, agentId: principal.agentId },
                  record.spec,
                  false,
                );
            record.audit = { uuid: row.uuid, entryId: row.entryId };
            if (!audits.includes(row.uuid)) audits.push(row.uuid);
            save(`drain-${dispatched.indexOf(record) + 1}.json`, row);
          }
        },
        assertNoReservation: async () => assertTask24Terminal(dispatched, await state('queue')),
        invalidatePending: async () => {},
        discover: async () => {},
        remove: async () => {
          const cleanup = await state('cleanup');
          const rows = await auditRows();
          for (const record of dispatched)
            capturedCallAudit(
              rows,
              record.baseline,
              { userId: baseline.gm.id, agentId: principal.agentId },
              record.spec,
              record.audit!,
            );
          const fresh = rows
            .filter(
              (r: any) =>
                !baseline.audits.includes(r.uuid) &&
                r.agentId === principal.agentId &&
                r.userId === baseline.gm.id,
            )
            .map((r: any) => r.uuid)
            .sort();
          if (JSON.stringify(fresh) !== JSON.stringify([...audits].sort()))
            throw Error('Exact retained code audit set mismatch');
          save('cleanup.json', { ...cleanup, retained: fresh.length });
          cleaned = true;
          console.log(`[task26] CLEAN v${generation} absent=1 retained=${fresh.length}`);
        },
      });
  } catch (error) {
    save('cleanup-failure.json', { message: String(error), uuid, audits });
    console.error(`[task26] MANUAL RECONCILIATION ${String(error)}`);
  }
  await client?.close();
  await server?.close();
  await browser?.context.close();
  await link.close();
  store.close();
}
if (!complete || !cleaned) throw Error('Task26 acceptance incomplete; inspect private evidence');
console.log(
  `[task26] COMPLETE v${generation} source=${task26Source} bundle=${hash} evidence=${evidence}`,
);
