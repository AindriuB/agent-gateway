/* eslint-disable @typescript-eslint/no-explicit-any */
/** Opt-in Task27 proof. Human approval only; no automatic decisions. */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadContext } from '../../../e2e/lib/context.js';
import { openUserBrowser, joinWorld, asJoinPage } from '../../../e2e/lib/browser.js';
import { LinkRegistry, LinkServer, PairingCodes } from '../../../gateway/src/link/index.js';
import { toolsets } from '../../../gateway/src/routing/index.js';
import { createSessionServer } from '../../../gateway/src/mcp/session.js';
import { openStore } from '../../../gateway/src/store/index.js';
import { readNativeWritePolicy } from '../tools/player-writes/live-policy.js';
import { waitForNativeApprovals } from '../tools/player-tokens-combat/native-approval.js';
import { prepareNativeCleanup } from '../tools/gm-documents/native-lifecycle.js';
import {
  freshCallAudit,
  capturedCallAudit,
  type NativeCall,
} from '../tools/gm-scene/native-plan.js';
import { assertTask24Terminal, assertTask24Decision } from '../tools/gm-scene/native-lifecycle.js';
import {
  task27CapturedFrame,
  task27OwnedSocket,
  task27DropSocket,
  task27Pins,
  task27Plan,
  assertTask27Privacy,
  assertTask27Sequence,
  type ObservedFrame,
} from './native-plan.js';
import { task27NativeState, task27ParticipantState } from './native-state.js';
const pins = task27Pins(
    process.env.AGENT_GATEWAY_TASK27_SOURCE,
    process.env.AGENT_GATEWAY_TASK27_BUNDLE,
  ),
  generation = Number(process.env.AGENT_GATEWAY_TASK27_GENERATION) as 13 | 14;
if (
  ![13, 14].includes(generation) ||
  process.env.AGENT_GATEWAY_TASK27_APPROVED !== 'exact-fixtures-and-cleanup'
)
  throw Error('Exact Task27 fixture consent required');
const root = fileURLToPath(new URL('../../../', import.meta.url)),
  { config, paths } = loadContext();
if (
  new URL(config.foundryOrigin).hostname !==
    (generation === 13 ? 'foundry13.local' : 'foundry.local') ||
  config.world !== 'test-world' ||
  config.linkPort !== (generation === 13 ? 7439 : 7429) ||
  !existsSync(paths.db)
)
  throw Error('Exact paired native test target required');
const bundle = readFileSync(resolve(root, 'dist/module/main.js')),
  hash = createHash('sha256').update(bundle).digest('hex');
if (hash !== pins.bundle) throw Error('Reviewed native bundle mismatch');
const run = randomBytes(6).toString('hex'),
  plan = task27Plan(run, generation),
  evidence = resolve('/private/tmp', `task27-native-v${generation}-${run}`);
mkdirSync(evidence, { recursive: true });
const save = (name: string, value: unknown) =>
  writeFileSync(resolve(evidence, name), JSON.stringify(value, null, 2));
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
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
type Participant = {
  browser: Awaited<ReturnType<typeof openUserBrowser>>;
  user: any;
  baseline: any;
  frames: ObservedFrame[];
  welcomes: any[];
  principal: any;
  viewAttempted: boolean;
};
const participants: Participant[] = [],
  outstanding: Promise<unknown>[] = [],
  audits: string[] = [],
  dispatched: any[] = [];
let baseline: any,
  ids: any,
  privateIds: any,
  publicUuid = '',
  fixtureAttempted = false,
  complete = false,
  cleaned = false,
  captureError = '',
  client: Client | undefined,
  server: ReturnType<typeof createSessionServer> | undefined;
function live(p: Participant) {
  if (captureError) throw Error(captureError);
  const c = registry.get(config.world, p.user.id);
  if (
    !c ||
    c.closed ||
    c.agentId !== p.principal.agentId ||
    c.worldId !== config.world ||
    c.userId !== p.user.id ||
    c.info.isGM !== (p.user.id === baseline.gm.id) ||
    !toolsets.get(c)
  )
    throw Error('Exact authenticated native participant unavailable');
  return c;
}
async function state(op: string, extra: Record<string, unknown> = {}) {
  return participants[0]!.browser.page.evaluate(task27NativeState, {
    op,
    run,
    generation,
    baseline,
    plan,
    ids,
    names: [config.playerUser, config.player2User],
    ...extra,
  });
}
async function participant(p: Participant, op: string, extra: Record<string, unknown> = {}) {
  return p.browser.page.evaluate(task27ParticipantState, {
    op,
    run,
    generation,
    user: p.user,
    isGM: p.user.id === baseline.gm.id,
    gmId: baseline.gm.id,
    worldTime: baseline.worldTime,
    baseline: p.baseline,
    sceneUuid: ids?.scene,
    ...extra,
  });
}
async function open(name: string, index: number) {
  const browser = await openUserBrowser(config, paths, name, { headed: true }),
    frames: ObservedFrame[] = [],
    welcomes: any[] = [];
  try {
    let served = 0,
      sockets = 0;
    browser.page.on('websocket', (ws) => {
      if (new URL(ws.url()).port !== String(config.linkPort)) return;
      const connection = `${index}/${++sockets}`;
      ws.on('framesent', ({ payload }) => {
        try {
          const frame = task27CapturedFrame(payload);
          if (!frame.event) return;
          if (frames.length >= 5000) throw Error('Passive native frame capacity exceeded');
          frames.push({ connection, receivedAt: Date.now(), event: frame.event });
        } catch {
          captureError = 'Invalid or oversized outbound native link frame';
        }
      });
      ws.on('framereceived', ({ payload }) => {
        try {
          const frame = task27CapturedFrame(payload);
          if (frame.welcome) welcomes.push({ connection, ...frame.welcome });
        } catch {
          captureError = 'Invalid or oversized inbound native link frame';
        }
      });
    });
    await browser.context.route('**/modules/agent-gateway/dist/module/main.js*', async (route) => {
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
      await browser.context.route(pattern!, (route) =>
        route.fulfill({ path: resolve(root, path!), contentType }),
      );
    await joinWorld(asJoinPage(browser.page), config, name);
    if (!served) throw Error('Exact reviewed module route not observed');
    return {
      browser,
      frames,
      welcomes,
      user: undefined,
      baseline: undefined,
      principal: undefined,
      viewAttempted: false,
    } as Participant;
  } catch (error) {
    await browser.context.close();
    throw error;
  }
}
async function chatCall(record: any) {
  live(participants[0]!);
  const result = await client!.callTool({ name: record.spec.tool, arguments: record.spec.args });
  save('sdk-immediate.json', result);
  let failed = result.isError === true,
    text = (result.content as any[])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n'),
    structured = result.structuredContent as any;
  const pending = structured?.status === 'pending_approval';
  if (pending)
    for (let n = 0; n < 600; n++) {
      const polled = await client!.callTool({
          name: 'approval_status',
          arguments: { id: structured.id },
        }),
        status = polled.structuredContent as any;
      if (polled.isError || ['expired', 'denied'].includes(status?.status))
        throw Error('Exact approval did not complete successfully');
      if (status?.result !== undefined) {
        failed = status.resultFailed === true;
        text = status.result;
        structured = undefined;
        break;
      }
      if (n === 599) throw Error('Bounded approval deadline reached');
      await delay(1000);
    }
  record.terminal = true;
  save('sdk-terminal.json', { failed, text, structured, pending });
  if (failed) throw Error('Native chat_post failed');
  return { text, structured, pending };
}
try {
  await link.listen();
  participants.push(await open(config.gmUser, 0));
  baseline = await state('baseline');
  participants[0]!.user = baseline.gm;
  save('baseline.json', { source: pins.source, bundle: hash, run, plan, baseline });
  let gmSocket: ReturnType<typeof task27OwnedSocket> | undefined;
  for (let n = 0; !gmSocket; n++) {
    try {
      if (!registry.get(config.world, baseline.gm.id)) throw Error('GM not authenticated');
      gmSocket = task27OwnedSocket(link);
    } catch (error) {
      if (n === 100) throw error;
      await delay(100);
    }
  }
  if (readNativeWritePolicy(baseline.policy).gm !== 'ask_owner')
    throw Error('Real human once policy required');
  for (let i = 0; i < 2; i++) {
    const p = await open(baseline.players[i].name, i + 1);
    p.user = baseline.players[i];
    participants.push(p);
  }
  for (const p of participants) {
    const pairs = store
      .listActivePairings()
      .filter((pair) => pair.worldId === config.world && pair.userId === p.user.id);
    if (pairs.length !== 1) throw Error('Exact unique paired native principal required');
    p.principal = { agentId: pairs[0]!.id };
    for (let n = 0; ; n++) {
      try {
        live(p);
        break;
      } catch (error) {
        if (n === 100) throw error;
        await delay(100);
      }
    }
    p.baseline = await participant(p, 'baseline');
    const gateway = await p.browser.page.evaluate(() =>
      String((globalThis as any).game.settings.get('agent-gateway', 'gatewayUrl')),
    );
    if (Number(new URL(gateway).port) !== config.linkPort)
      throw Error('Native gateway port mismatch');
  }
  save(
    'participants-before.json',
    participants.map((p) => ({
      user: p.user,
      baseline: p.baseline,
      principal: p.principal,
      connectionId: live(p).id,
    })),
  );
  server = createSessionServer({
    version: '0.1.0',
    registry,
    selector: { world: config.world, user: baseline.gm.id },
    knownIdentities: () =>
      store
        .listActivePairings()
        .map((p) => ({ worldId: p.worldId, userId: p.userId, userName: p.userName })),
    log: () => {},
  });
  client = new Client({ name: 'task27-native', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  if (!(await client.listTools()).tools.some((t) => t.name === 'chat_post'))
    throw Error('Native chat tool not announced');
  await participants[0]!.browser.page.evaluate(
    ({ source, path }) => {
      const h = (globalThis as any).Handlebars;
      h.registerPartial(path, h.compile(source));
    },
    {
      source: readFileSync(resolve(root, 'templates/approval/approval.hbs'), 'utf8'),
      path: 'modules/agent-gateway/templates/approval/approval.hbs',
    },
  );
  for (const p of participants) live(p);
  fixtureAttempted = true;
  ids = await state('create');
  save('fixtures.json', ids);
  for (const p of participants) {
    p.viewAttempted = true;
    await participant(p, 'view');
    await p.browser.page.waitForFunction(() => {
      const g = globalThis as any;
      return (
        g.canvas.ready &&
        g.canvas.scene.tokens.contents.every((t: any) => t._object?.destroyed === false)
      );
    });
  }
  const before = participants.map((p) => p.frames.length),
    timing = await state('update', { phase: 'coalesce' });
  await delay(800);
  for (let i = 0; i < participants.length; i++) {
    const matching = participants[i]!.frames.slice(before[i]).filter(
      (f: any) => f.event.doc?.uuid === ids.actor && f.event.type === 'actor_update',
    );
    if (matching.length !== 1 || (matching[0]!.event as any).doc.name !== plan.actorNames[1])
      throw Error('Native coalescing proof failed');
  }
  save('coalesce.json', { timing, frames: participants.map((p, i) => p.frames.slice(before[i])) });
  privateIds = await state('private');
  save('private-messages.json', privateIds);
  await state('update', { phase: 'tokens' });
  await delay(800);
  const gm = participants[0]!,
    old = live(gm),
    reconnectStart = gm.frames.length,
    pending = await state('update', { phase: 'pending' });
  task27DropSocket(link, gmSocket, old, live(gm));
  const closedAt = Date.now();
  if (closedAt - pending.acknowledgedAt >= 500) throw Error('Pending disconnect timing not proven');
  for (let n = 0; ; n++) {
    await delay(100);
    const c = registry.get(config.world, gm.user.id);
    if (c && !c.closed && c.id !== old.id) break;
    if (n === 200) throw Error('Native reconnect timed out');
  }
  await delay(600);
  if (gm.frames.slice(reconnectStart).some((f: any) => f.event.doc?.uuid === ids.actor))
    throw Error('Old pending event leaked across reconnect');
  await state('update', { phase: 'reconnected' });
  await delay(800);
  const reconnectFrames = gm.frames.slice(reconnectStart);
  if (
    reconnectFrames.filter(
      (f: any) =>
        f.event.type === 'actor_update' &&
        f.event.doc?.uuid === ids.actor &&
        f.event.doc.name === plan.actorNames[3],
    ).length !== 1
  )
    throw Error('Fresh reconnected event missing');
  save('reconnect.json', {
    old: old.id,
    current: live(gm).id,
    pending,
    closedAt,
    frames: reconnectFrames,
    welcomes: gm.welcomes,
  });
  const spec: NativeCall = {
      tool: plan.publicCall.tool,
      args: plan.publicCall.args,
      expected: 'ok',
      audit: true,
    },
    record: any = {
      spec,
      baseline: (await state('audits')).map((r: any) => r.uuid),
      terminal: false,
      denied: false,
    };
  dispatched.push(record);
  const operation = chatCall(record);
  outstanding.push(
    operation.then(
      () => undefined,
      () => undefined,
    ),
  );
  await waitForNativeApprovals(gm.browser.page, 1);
  const cards = await gm.browser.page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('article[data-request]')].map((c) => ({
      id: c.dataset.request!,
      tool: c.querySelector('h3')?.textContent?.trim(),
      args: JSON.parse(c.querySelector('.ag-approval-payload')?.textContent ?? 'null'),
    })),
  );
  if (
    cards.length !== 1 ||
    cards[0]!.tool !== spec.tool ||
    JSON.stringify(cards[0]!.args) !== JSON.stringify(spec.args)
  )
    throw Error('Exact one native approval required');
  record.approvalId = cards[0]!.id;
  save('approval.json', cards);
  await gm.browser.page.bringToFront();
  await gm.browser.page.screenshot({ path: resolve(evidence, 'approval.png') });
  console.log(
    `[task27] READY v${generation} tool=chat_post human=APPROVE_ONCE evidence=${evidence}`,
  );
  const result = await operation,
    approval = (await state('queue')).find((r: any) => r.id === record.approvalId);
  save('terminal.json', { result, approval });
  assertTask24Decision(approval, baseline.gm.name, false);
  let audit: any;
  for (let n = 0; ; n++) {
    try {
      audit = freshCallAudit(
        await state('audits'),
        record.baseline,
        { userId: baseline.gm.id, agentId: gm.principal.agentId },
        spec,
      );
      break;
    } catch (error) {
      if (n === 100) throw error;
      await delay(100);
    }
  }
  record.audit = { uuid: audit.uuid, entryId: audit.entryId };
  audits.push(audit.uuid);
  save('audit.json', audit);
  const created = audit.targets.filter(
    (t: any) => t.existed === false && t.uuid.startsWith('ChatMessage.'),
  );
  if (created.length !== 1) throw Error('Exact audited native public message required');
  publicUuid = created[0].uuid;
  await state('bindPublic', { publicUuid });
  await delay(800);
  const facts = [];
  for (const p of participants)
    facts.push(
      await participant(p, 'facts', {
        messageUUIDs: [publicUuid, privateIds.whisper, privateIds.blind],
      }),
    );
  save('participant-facts.json', facts);
  for (let i = 0; i < participants.length; i++) {
    const p = participants[i]!;
    assertTask27Sequence(p.frames);
    assertTask27Privacy(
      p.frames,
      [
        plan.whisper,
        plan.blind,
        ...(i
          ? [
              privateIds.whisper,
              privateIds.blind,
              ids.tokens[1],
              plan.tokens[1]!.name,
              plan.tokenNames[1]!,
            ]
          : []),
      ],
      p.user.id,
    );
    if (
      !p.frames.some(
        (f: any) =>
          f.event.doc?.uuid === publicUuid &&
          f.event.type === 'chat' &&
          f.event.agent_action === true,
      ) ||
      !p.frames.some(
        (f: any) => f.event.doc?.uuid === ids.tokens[0] && f.event.type === 'token_update',
      )
    )
      throw Error('Expected public agent/token events missing');
    if (facts[i].messages.some((m: any, j: number) => m.contentVisible !== (i === 0 || j === 0)))
      throw Error('Native chat content visibility mismatch');
    if (
      i === 0 &&
      (!p.frames.some(
        (f: any) => f.event.doc?.uuid === privateIds.whisper && f.event.type === 'chat',
      ) ||
        !p.frames.some(
          (f: any) => f.event.doc?.uuid === privateIds.blind && f.event.type === 'roll',
        ))
    )
      throw Error('Expected recipient private events missing');
    live(p);
  }
  save(
    'frames.json',
    participants.map((p) => ({ user: p.user, welcomes: p.welcomes, frames: p.frames })),
  );
  save('native-facts.json', {
    source: pins.source,
    bundle: hash,
    generation,
    fixtureCount: plan.fixtureCount,
    audit,
    facts,
    pendingCompletion: result.pending,
  });
  complete = true;
} catch (error) {
  save('failure.json', { message: String(error), ids, privateIds, publicUuid, audits });
  throw error;
} finally {
  try {
    if (baseline && fixtureAttempted)
      await prepareNativeCleanup({
        baselineCaptured: true,
        settle: async () => {
          await Promise.all(outstanding);
        },
        drain: async () => {
          if (dispatched.some((r) => !r.terminal))
            throw Error('Unproven terminality: manual reconciliation required');
          for (const r of dispatched) {
            const row: any = r.audit
              ? capturedCallAudit(
                  await state('audits'),
                  r.baseline,
                  { userId: baseline.gm.id, agentId: participants[0]!.principal.agentId },
                  r.spec,
                  r.audit,
                )
              : freshCallAudit(
                  await state('audits'),
                  r.baseline,
                  { userId: baseline.gm.id, agentId: participants[0]!.principal.agentId },
                  r.spec,
                  false,
                );
            r.audit = { uuid: row.uuid, entryId: row.entryId };
            if (!audits.includes(row.uuid)) audits.push(row.uuid);
            save('drain.json', row);
            const created = row.targets.filter(
              (t: any) => t.existed === false && t.uuid.startsWith('ChatMessage.'),
            );
            if (created.length !== 1) throw Error('Unknown public message provenance');
            publicUuid = created[0].uuid;
            await state('bindPublic', { publicUuid });
          }
        },
        assertNoReservation: async () => assertTask24Terminal(dispatched, await state('queue')),
        invalidatePending: async () => {},
        discover: async () => {},
        remove: async () => {
          const restored = [];
          for (const p of participants)
            if (p.viewAttempted) restored.push(await participant(p, 'restore'));
          save('views-restored.json', restored);
          const expectedUUIDs = [
            ids?.actor,
            ids?.scene,
            ...(ids?.tokens ?? []),
            ...(ids?.levels ?? []),
            privateIds?.whisper,
            privateIds?.blind,
            publicUuid,
          ].filter(Boolean);
          const cleanup = await state('cleanup', { expectedUUIDs, publicUuid, audits }),
            rows = await state('audits');
          for (const r of dispatched)
            capturedCallAudit(
              rows,
              r.baseline,
              { userId: baseline.gm.id, agentId: participants[0]!.principal.agentId },
              r.spec,
              r.audit,
            );
          const fresh = rows
            .filter(
              (r: any) =>
                !baseline.audits.includes(r.uuid) &&
                r.userId === baseline.gm.id &&
                r.agentId === participants[0]!.principal.agentId,
            )
            .map((r: any) => r.uuid)
            .sort();
          if (
            JSON.stringify(fresh) !== JSON.stringify([...audits].sort()) ||
            (complete &&
              (cleanup.absent !== plan.fixtureCount || restored.length !== 3 || fresh.length !== 1))
          )
            throw Error('Exact cleanup/audit retention mismatch');
          save('cleanup.json', {
            ...cleanup,
            retained: fresh.length,
            viewsRestored: restored.length,
            expectedUUIDs,
          });
          cleaned = true;
          console.log(
            `[task27] CLEAN v${generation} absent=${cleanup.absent} retained=${fresh.length}`,
          );
        },
      });
  } catch (error) {
    save('cleanup-failure.json', { message: String(error), ids, privateIds, publicUuid, audits });
    console.error(`[task27] MANUAL RECONCILIATION ${String(error)}`);
  }
  save(
    'frames-final.json',
    participants.map((p) => ({ user: p.user, welcomes: p.welcomes, frames: p.frames })),
  );
  await client?.close();
  await server?.close();
  for (const p of [...participants].reverse()) await p.browser.context.close();
  await link.close();
  store.close();
}
if (captureError) save('capture-failure.json', { message: captureError });
if (!complete || !cleaned || captureError)
  throw Error('Task27 acceptance incomplete; inspect private evidence');
console.log(
  `[task27] COMPLETE v${generation} source=${pins.source} bundle=${hash} evidence=${evidence}`,
);
