/* eslint-disable @typescript-eslint/no-explicit-any */
/** Opt-in Task25 native acceptance executor. No automated approval/denial clicks. Never run without exact human consent. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
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
import { assertNativeApprovalCards } from '../gm-documents/native-plan.js';
import { waitForNativeApprovals } from '../player-tokens-combat/native-approval.js';
import { prepareNativeCleanup } from '../gm-documents/native-lifecycle.js';
import { freshCallAudit, capturedCallAudit, type NativeCall } from '../gm-scene/native-plan.js';
import { assertTask24Terminal, assertTask24Decision } from '../gm-scene/native-lifecycle.js';
import { task25ProofPins, task25FixtureData, task25Calls } from './native-plan.js';
import { task25NativeState } from './native-state.js';
import { assertTask25Completion, assertTask25PrivateChat } from './native-checks.js';
const { source: task25Source, bundle: task25Bundle } = task25ProofPins(
  process.env.AGENT_GATEWAY_TASK25_SOURCE,
  process.env.AGENT_GATEWAY_TASK25_BUNDLE,
);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const generation = Number(process.env.AGENT_GATEWAY_TASK25_GENERATION);
if (
  ![13, 14].includes(generation) ||
  process.env.AGENT_GATEWAY_TASK25_APPROVED !== 'exact-fixtures-and-cleanup'
)
  throw Error('Exact Task25 fixture and cleanup consent required');
const { config, paths } = loadContext();
if (config.world !== 'test-world' || config.linkPort !== (generation === 13 ? 7439 : 7429))
  throw Error('Exact test-world and generation-specific native link port required');
const run = randomBytes(6).toString('hex'),
  evidence = resolve('/private/tmp', `task25-native-v${generation}-${run}`);
mkdirSync(evidence, { recursive: true });
const bundle = readFileSync(resolve(root, 'dist/module/main.js')),
  hash = createHash('sha256').update(bundle).digest('hex');
if (hash !== task25Bundle) throw Error('Reviewed source bundle mismatch');
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
const participants: Awaited<ReturnType<typeof openUserBrowser>>[] = [],
  views: any[] = [],
  roots: string[] = [],
  created: string[] = [],
  audits: string[] = [],
  messages: string[] = [],
  outstanding: Promise<unknown>[] = [];
const ids = {
  table: '',
  playlist: '',
  player: '',
  sounds: [] as string[],
  results: [] as string[],
};
let complete = false,
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
    ['table_roll', 'playlist_control', 'notify'].some((name) => !tools.some((t) => t.name === name))
  )
    throw Error('Authenticated exact live principal/tool announcement unavailable');
  return c;
}
async function state(op: string, extra: Record<string, unknown> = {}) {
  return browser!.page.evaluate(task25NativeState, {
    op,
    generation,
    run,
    baseline,
    ids,
    ...extra,
  });
}
async function auditRows() {
  return browser!.page.evaluate(() => {
    const g = (globalThis as any).game;
    return g.journal
      .get(g.settings.get('agent-gateway', 'auditJournalId'))
      .pages.contents.map((p: any) => ({ uuid: p.uuid, ...p.system.toObject() }));
  });
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
async function nativeCall(record: Dispatched) {
  const { spec } = record;
  livePrincipal();
  const result = await client!.callTool({ name: spec.tool, arguments: spec.args });
  save(`sdk-immediate-${dispatched.indexOf(record) + 1}.json`, { spec, result });
  let failed = result.isError === true,
    text = (result.content as any[])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
  let structured = result.structuredContent as any;
  const pendingCompletion = structured?.status === 'pending_approval';
  if (structured?.status === 'pending_approval') {
    console.log(`[task25] PENDING v${generation} ${spec.tool} idPresent=true`);
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
  if (spec.expected === 'ok' ? failed : !failed || !text.includes(spec.expected))
    throw Error(`Unexpected native result for ${spec.tool}: ${text}`);
  return { failed, text, structured, pendingCompletion };
}
async function step(index: number) {
  livePrincipal();
  const spec = task25Calls(ids, run)[index]!,
    before = await auditRows(),
    record: Dispatched = {
      spec,
      baseline: before.map((r: any) => r.uuid),
      terminal: false,
      denied: false,
    };
  dispatched.push(record);
  const operation = nativeCall(record).catch((error) => {
    save(`sdk-error-${index + 1}.json`, { spec, message: String(error) });
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
    })),
  );
  assertNativeApprovalCards(cards, [{ name: spec.tool, args: spec.args }]);
  record.approvalId = cards[0]!.id;
  save(`approval-${index + 1}.json`, cards);
  await browser!.page.bringToFront();
  await browser!.page.screenshot({ path: resolve(evidence, `approval-${index + 1}.png`) });
  console.log(
    `[task25] READY v${generation} step=${index + 1}/7 tool=${spec.tool} action=${'action' in spec.args ? spec.args.action : 'draw-or-notify'} human=APPROVE_ONCE`,
  );
  const result = await operation;
  save(`terminal-${index + 1}.json`, { spec, result });
  const approval = await browser!.page.evaluate((id) => {
    const g = (globalThis as any).game;
    return (
      JSON.parse(localStorage.getItem(`agent-gateway.${g.world.id}.approvalQueue`) ?? '{}')[
        g.user.id
      ] ?? []
    ).find((r: any) => r.id === id);
  }, record.approvalId);
  save(`terminal-${index + 1}.json`, { spec, result, approval });
  assertTask24Decision(approval, baseline.gm.name, false);
  let audit: any;
  for (let n = 0; n <= 100; n++) {
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
  if (audit.category !== 'write' || audit.status !== 'ok' || audits.includes(audit.uuid))
    throw Error('Exact fresh write audit outcome mismatch');
  record.audit = { uuid: audit.uuid, entryId: audit.entryId };
  audits.push(audit.uuid);
  save(`audit-${index + 1}.json`, audit);
  const facts = await state('facts', { index });
  if (facts.message && !messages.includes(facts.message.uuid)) {
    messages.push(facts.message.uuid);
    created.push(facts.message.uuid);
  }
  save(`result-${index + 1}.json`, { spec, result, audit, approval, facts });
  if (index < 2)
    assertTask25Completion({
      result,
      table: facts.table,
      resultIds: ids.results,
      reference: baseline.reference.uuid,
      run,
      chat: index === 1,
      audit,
      nativeChatUuid: facts.message?.uuid,
    });
  console.log(`[task25] RESULT v${generation} step=${index + 1} freshAudit=true`);
}
async function view(participant: Awaited<ReturnType<typeof openUserBrowser>>) {
  return participant.page.evaluate(() => {
    const g = globalThis as any;
    return {
      user: g.game.user.id,
      scene: g.canvas.scene?.id ?? null,
      level: g.canvas.level?.id ?? null,
      combat: g.ui.combat.viewed?.uuid ?? null,
      targets: [...g.game.user.targets].map((t: any) => t.id).sort(),
      active: g.game.scenes.contents
        .filter((s: any) => s.active)
        .map((s: any) => s.id)
        .sort(),
      time: g.game.time.worldTime,
    };
  });
}
async function open(name: string) {
  const b = await openUserBrowser(config, paths, name, { headed: true });
  participants.push(b);
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
    ['**/modules/agent-gateway/styles/agent-gateway.css*', 'styles/agent-gateway.css', 'text/css'],
  ])
    await b.context.route(pattern!, (route) =>
      route.fulfill({ path: resolve(root, path!), contentType }),
    );
  await joinWorld(asJoinPage(b.page), config, name);
  if (!served) throw Error('Exact routed bundle not observed');
  return b;
}
try {
  await link.listen();
  browser = await open(config.gmUser);
  const rawPolicy = await browser.page.evaluate(() =>
    (globalThis as any).game.settings.get('agent-gateway', 'worldPolicy'),
  );
  if (readNativeWritePolicy(rawPolicy).gm !== 'ask_owner')
    throw Error('Real human once approval policy required');
  baseline = await state('baseline', { playerName: 'Player1', player2Name: 'Player2' });
  save('baseline.json', { source: task25Source, bundle: hash, run, baseline });
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
  for (const player of baseline.players) await open(player.name);
  for (const [participantIndex, b] of participants.entries()) {
    const expected = participantIndex === 0 ? baseline.gm : baseline.players[participantIndex - 1];
    await b.page.evaluate(
      ({ id, generation, isGM }) => {
        const g = (globalThis as any).game;
        if (
          !g.ready ||
          g.world.id !== 'test-world' ||
          Number(g.release.generation) !== generation ||
          g.user.id !== id ||
          g.users.get(id) !== g.user ||
          g.user.isGM !== isGM
        )
          throw Error('Exact canonical native participant identity mismatch');
      },
      { id: expected.id, generation, isGM: participantIndex === 0 },
    );
    views.push(await view(b));
    await b.page.evaluate((prefix) => {
      const g = globalThis as any;
      g.__task25Notices = [];
      const observer = new MutationObserver(() => {
        for (const e of document.querySelectorAll<HTMLElement>('.notification'))
          if (
            e.textContent?.includes(prefix) &&
            !g.__task25Notices.some((r: any) => r.html === e.innerHTML)
          )
            g.__task25Notices.push({
              text: e.textContent,
              html: e.innerHTML,
              markup: !!e.querySelector('b,script,img,iframe'),
            });
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      g.__task25NoticeObserver = observer;
    }, `ag-task25-${run}`);
  }
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
  client = new Client({ name: 'task25-native', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  const listed = await client.listTools();
  if (
    ['table_roll', 'playlist_control', 'notify'].some(
      (name) => !listed.tools.some((t) => t.name === name),
    )
  )
    throw Error('Exact tools not announced');
  livePrincipal();
  const data = task25FixtureData(run, baseline.reference.uuid);
  for (const [type, source] of [
    ['RollTable', data.table],
    ['Playlist', data.playlist],
  ] as const) {
    livePrincipal();
    fixtureAttempted = true;
    const made = await state('create', { type, source });
    roots.push(made.uuid);
    created.push(made.uuid, ...made.children.map((r: any) => r.uuid));
    if (type === 'RollTable') {
      ids.table = made.uuid;
      ids.results = made.children.map((r: any) => r.id);
    } else {
      ids.playlist = made.uuid;
      ids.sounds = made.children
        .sort((a: any, b: any) => a.source.sort - b.source.sort)
        .map((r: any) => r.id);
    }
    save('fixtures.json', { roots, created, ids });
  }
  ids.player = baseline.players[0].id;
  for (let i = 0; i < 7; i++) {
    if (i === 1) {
      const reset = await state('reset');
      save('fixture-reset.json', reset);
    }
    if (i === 5) await state('facts', { index: 4 });
    await step(i);
  }
  await new Promise((r) => setTimeout(r, 500));
  await browser.page.waitForFunction(
    (uuid) =>
      !!document.querySelector(
        `[data-message-id="${uuid.split('.').at(-1)}"] .agent-gateway-ai-marker`,
      ),
    messages[0],
    { timeout: 10000 },
  );
  const participantFacts = [];
  for (let i = 0; i < participants.length; i++) {
    const facts = await participants[i]!.page.evaluate(
      ({ gm, expectedId, generation, messageUuid }) => {
        const g = globalThis as any;
        if (
          g.game.user.id !== expectedId ||
          g.game.users.get(expectedId) !== g.game.user ||
          g.game.world.id !== 'test-world' ||
          Number(g.game.release.generation) !== generation
        )
          throw Error('Native participant identity changed');
        const card = document.querySelector(`[data-message-id="${messageUuid.split('.').at(-1)}"]`);
        const m = g.game.messages.contents.filter((m: any) => m.uuid === messageUuid);
        return {
          user: g.game.user.id,
          chatDOM: {
            present: !!card,
            aiMarker: !!card?.querySelector('.agent-gateway-ai-marker'),
            text: card?.textContent ?? '',
            formulas: [...(card?.querySelectorAll('.dice-formula') ?? [])].map(
              (e) => e.textContent ?? '',
            ),
            totals: [...(card?.querySelectorAll('.dice-total') ?? [])].map(
              (e) => e.textContent ?? '',
            ),
            tooltip: [...(card?.querySelectorAll('.dice-tooltip') ?? [])]
              .map((e) => e.textContent ?? '')
              .join(''),
          },
          notices: g.__task25Notices,
          localizedMarker: g.game.i18n.localize('AGENT_GATEWAY.Tools.aiMarker'),
          messages: m.map((m: any) => ({
            uuid: m.uuid,
            visible: m.visible,
            isContentVisible: m.isContentVisible,
            content: m.content,
            blind: m.blind,
            ai: m.flags?.['agent-gateway']?.ai,
          })),
          gm,
        };
      },
      {
        gm: baseline.gm.id,
        expectedId: i === 0 ? baseline.gm.id : baseline.players[i - 1].id,
        generation,
        messageUuid: messages[0]!,
      },
    );
    participantFacts.push(facts);
    save(`participant-${i}.json`, facts);
    await participants[i]!.page.screenshot({ path: resolve(evidence, `participant-${i}.png`) });
  }
  save('participants.json', participantFacts);
  for (const [i, facts] of participantFacts.entries()) {
    if (i === 1) {
      if (
        typeof facts.localizedMarker !== 'string' ||
        !facts.localizedMarker ||
        facts.localizedMarker === 'AGENT_GATEWAY.Tools.aiMarker' ||
        facts.notices.length !== 1 ||
        !facts.notices[0].text.includes(
          `${facts.localizedMarker}: <b>ag-task25-${run} notice</b>`,
        ) ||
        !facts.notices[0].text.includes(`<b>ag-task25-${run} notice</b>`) ||
        facts.notices[0].markup
      )
        throw Error('Target notification literal native display mismatch');
    } else if (facts.notices.length) throw Error('Notification reached an unintended participant');
    assertTask25PrivateChat({
      gm: i === 0,
      run,
      reference: baseline.reference.uuid,
      messages: facts.messages,
      chatDOM: facts.chatDOM,
    });
  }
  save('participants.json', participantFacts);
  if (created.length !== 7 || audits.length !== 7)
    throw Error('Exact seven fixture/audit identities required');
  complete = true;
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
            throw Error('Unproven terminal call; manual reconciliation required');
          for (const record of dispatched) {
            let observed: any;
            for (let n = 0; n <= 100; n++) {
              try {
                observed = record.audit
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
                break;
              } catch (error) {
                if (n === 100) throw error;
                await new Promise((r) => setTimeout(r, 100));
              }
            }
            if (!audits.includes(observed.uuid)) audits.push(observed.uuid);
            for (const target of observed.targets ?? [])
              if (
                target.existed === false &&
                target.uuid?.startsWith('ChatMessage.') &&
                !baseline.messages.includes(target.uuid) &&
                !messages.includes(target.uuid)
              ) {
                messages.push(target.uuid);
                created.push(target.uuid);
              }
          }
        },
        assertNoReservation: async () => {
          const queue = await browser!.page.evaluate(() => {
            const g = (globalThis as any).game;
            return (
              JSON.parse(localStorage.getItem(`agent-gateway.${g.world.id}.approvalQueue`) ?? '{}')[
                g.user.id
              ] ?? []
            );
          });
          assertTask24Terminal(dispatched, queue);
        },
        invalidatePending: async () => {},
        discover: async () => {},
        remove: async () => {
          const cleanup = await state('cleanup', { messages, created, audits });
          const rows = await auditRows();
          for (const record of dispatched)
            if (record.audit)
              capturedCallAudit(
                rows,
                record.baseline,
                { userId: baseline.gm.id, agentId: principal.agentId },
                record.spec,
                record.audit,
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
            throw Error('Final exact persisted audit set mismatch');
          for (let i = 0; i < participants.length; i++)
            if (JSON.stringify(await view(participants[i]!)) !== JSON.stringify(views[i]))
              throw Error('Participant scene/level/targets/combat/time changed');
          save('cleanup.json', { ...cleanup, retained: fresh.length, viewsUnchanged: true });
          cleaned = true;
          console.log(
            `[task25] CLEAN v${generation} absent=${created.length} retained=${fresh.length}`,
          );
        },
      });
  } catch (error) {
    save('cleanup-failure.json', { message: String(error), roots, created, audits });
    console.error(`[task25] MANUAL RECONCILIATION ${String(error)}`);
  }
  await client?.close();
  await server?.close();
  for (const p of participants) await p.context.close();
  await link.close();
  store.close();
}
if (!complete || !cleaned)
  throw Error('Task25 native acceptance incomplete; inspect private evidence');
console.log(
  `[task25] COMPLETE v${generation} source=${task25Source} bundle=${hash} evidence=${evidence}`,
);
