/* eslint-disable @typescript-eslint/no-explicit-any */
/** Opt-in Task24 native acceptance executor. No automated approval/denial clicks. Never run without exact human consent. */
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
import { nativeDestructivePolicy, assertNativeApprovalCards } from '../gm-documents/native-plan.js';
import { waitForNativeApprovals } from '../player-tokens-combat/native-approval.js';
import { prepareNativeCleanup } from '../gm-documents/native-lifecycle.js';
import {
  task24ProofPins,
  task24Calls,
  task24FixtureData,
  freshCallAudit,
  capturedCallAudit,
  assertTask24Audit,
  type NativeIds,
  type NativeCall,
} from './native-plan.js';
import {
  assertTask24Terminal,
  assertTask24Decision,
  assertTask24Activation,
  assertTask24Bundle,
  assertTask24Principal,
  task24RemoveFixtures,
} from './native-lifecycle.js';
import { task24StepFacts } from './native-facts.js';
import { task24Readiness } from './native-readiness.js';
const { source: TASK24_SOURCE, bundle: TASK24_BUNDLE } = task24ProofPins(
  process.env.AGENT_GATEWAY_TASK24_SOURCE,
  process.env.AGENT_GATEWAY_TASK24_BUNDLE,
);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const preflightOnly = process.env.AGENT_GATEWAY_TASK24_PREFLIGHT === 'readonly';
const generation = Number(process.env.AGENT_GATEWAY_TASK24_GENERATION);
if (
  (generation !== 13 && generation !== 14) ||
  (!preflightOnly && process.env.AGENT_GATEWAY_TASK24_APPROVED !== 'exact-fixtures-and-cleanup')
)
  throw Error('Exact generation-specific Task24 fixture and cleanup approval required');
const { config, paths } = loadContext();
if (config.world !== 'test-world') throw Error('Only test-world is approved');
const run = randomBytes(6).toString('hex');
const evidence = resolve('/private/tmp', `task24-native-v${generation}-${run}`);
mkdirSync(evidence, { recursive: true });
const bundle = readFileSync(resolve(root, 'dist/module/main.js'));
const hash = createHash('sha256').update(bundle).digest('hex');
assertTask24Bundle(hash, TASK24_BUNDLE);
const data = task24FixtureData(run, generation);
const store = openStore(paths.db),
  registry = new LinkRegistry();
const link = new LinkServer({
  port: config.linkPort,
  store,
  registry,
  codes: new PairingCodes(),
  allowedOrigins: [config.foundryOrigin],
  gatewayVersion: '0.1.0',
});
let browser: Awaited<ReturnType<typeof openUserBrowser>> | undefined;
let client: Client | undefined;
let server: ReturnType<typeof createSessionServer> | undefined;
let baseline: ReturnType<typeof task24Readiness> | undefined;
let activationGuard: Array<{ uuid: string; source: unknown }> | undefined;
let pinnedConnectionId = '';
let principal: { worldId: string; userId: string; agentId: string } | undefined;
function livePrincipal() {
  if (!principal) throw Error('Pinned principal unavailable');
  const conn = registry.get(principal.worldId, principal.userId);
  assertTask24Principal(principal, conn, conn ? toolsets.get(conn) : undefined);
  if (pinnedConnectionId && conn!.id !== pinnedConnectionId)
    throw Error('Authenticated executor connection replaced');
  return principal;
}
let complete = false,
  cleaned = false;
const roots: string[] = [],
  created: string[] = [],
  audits: string[] = [],
  outstanding: Promise<unknown>[] = [];
const ids: NativeIds = {
  actor: '',
  scene: '',
  combat: '',
  tokens: ['', ''],
  combatants: ['', ''],
  level: '',
};
const save = (name: string, value: unknown) =>
  writeFileSync(resolve(evidence, name), JSON.stringify(value, null, 2));
async function auditRows() {
  return browser!.page.evaluate(() => {
    const g = (globalThis as any).game;
    const journal = g.journal.get(g.settings.get('agent-gateway', 'auditJournalId'));
    return journal.pages.contents.map((p: any) => ({ uuid: p.uuid, ...p.system.toObject() }));
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
  if (structured?.status === 'pending_approval') {
    console.log(`[task24] PENDING v${generation} ${spec.tool} idPresent=true`);
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
  return { failed, text, structured };
}
async function step(index: number) {
  const spec = task24Calls(ids, generation as 13 | 14)[index]!;
  await browser!.page.evaluate((expected) => {
    if ((globalThis as any).game.time.worldTime !== expected)
      throw Error('World time changed before call');
  }, baseline!.worldTime);
  const before = await auditRows();
  const auditBaseline = before.map((r: any) => r.uuid);
  const record: Dispatched = { spec, baseline: auditBaseline, terminal: false, denied: false };
  dispatched.push(record);
  const refusalBefore =
    index === 9 || index === 12
      ? await browser!.page.evaluate(async (uuid) => {
          const g = globalThis as any;
          const c = await g.fromUuid(uuid);
          return {
            source: c.toObject(),
            messages: g.game.messages.contents.map((m: any) => m.uuid).sort(),
          };
        }, ids.combat)
      : undefined;
  livePrincipal();
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
    `[task24] READY v${generation} step=${index + 1}/16 tool=${spec.tool} action=${spec.args.action} human=${spec.expected === 'DENIED' ? 'DENY' : 'APPROVE'}`,
  );
  const result = await operation;
  const approval = await browser!.page.evaluate((id) => {
    const g = globalThis as any;
    const records =
      JSON.parse(localStorage.getItem(`agent-gateway.${g.game.world.id}.approvalQueue`) ?? '{}')[
        g.game.user.id
      ] ?? [];
    return records.find((r: any) => r.id === id);
  }, cards[0]!.id);
  assertTask24Decision(approval, baseline!.gm.name, spec.expected === 'DENIED');
  if (spec.expected === 'DENIED') {
    record.denied = true;
    const rows = await auditRows();
    if (
      rows.some(
        (r: any) =>
          !auditBaseline.includes(r.uuid) &&
          r.userId === baseline!.gm.id &&
          r.tool === spec.tool &&
          r.args === JSON.stringify(spec.args),
      )
    )
      throw Error('Denied request unexpectedly entered audit execution');
  }
  if (refusalBefore) {
    const after = await browser!.page.evaluate(async (uuid) => {
      const g = globalThis as any;
      const c = await g.fromUuid(uuid);
      return {
        source: c.toObject(),
        messages: g.game.messages.contents.map((m: any) => m.uuid).sort(),
      };
    }, ids.combat);
    if (JSON.stringify(after) !== JSON.stringify(refusalBefore))
      throw Error('Refused initiative/denied end mutated encounter or chat');
  }
  let audit: any;
  if (spec.audit) {
    const identity = {
      userId: baseline!.gm.id,
      agentId: principal!.agentId,
    };
    for (let i = 0; i <= 100; i++) {
      try {
        audit = freshCallAudit(await auditRows(), auditBaseline, identity, spec);
        break;
      } catch (error) {
        if (i === 100) throw error;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assertTask24Audit(audit, spec);
    if (audits.includes(audit.uuid)) throw Error('Audit identity reused across native calls');
    audits.push(audit.uuid);
    record.audit = { uuid: audit.uuid, entryId: audit.entryId };
  }
  save(`result-${index + 1}.json`, { spec, result, audit, approval });
  console.log(
    `[task24] RESULT v${generation} step=${index + 1} expected=${spec.expected} freshAudit=${!!audit}`,
  );
  return audit;
}
try {
  await link.listen();
  browser = await openUserBrowser(config, paths, config.gmUser, { headed: true });
  let served = 0;
  await browser.context.route('**/modules/agent-gateway/dist/module/main.js*', async (route) => {
    const current = readFileSync(resolve(root, 'dist/module/main.js'));
    assertTask24Bundle(createHash('sha256').update(current).digest('hex'), hash);
    await route.fulfill({ body: current, contentType: 'text/javascript' });
    served++;
  });
  for (const [pattern, path, contentType] of [
    ['**/modules/agent-gateway/lang/en.json*', 'lang/en.json', 'application/json'],
    ['**/modules/agent-gateway/styles/agent-gateway.css*', 'styles/agent-gateway.css', 'text/css'],
  ])
    await browser.context.route(pattern!, (route) =>
      route.fulfill({ path: resolve(root, path!), contentType }),
    );
  await joinWorld(asJoinPage(browser.page), config, config.gmUser);
  if (served < 1) throw Error('Exact reviewed bundle was not observed in the browser');
  const rawPolicy = await browser.page.evaluate(() =>
    (globalThis as any).game.settings.get('agent-gateway', 'worldPolicy'),
  );
  if (
    readNativeWritePolicy(rawPolicy).gm !== 'ask_owner' ||
    nativeDestructivePolicy(rawPolicy) !== 'ask_owner'
  )
    throw Error('Owner approval policy prerequisite failed');
  baseline = await browser.page.evaluate(task24Readiness, generation as 13 | 14);
  save('baseline.json', { source: TASK24_SOURCE, bundle: hash, run, baseline });
  const pairs = store
    .listActivePairings()
    .filter((p) => p.worldId === config.world && p.userId === baseline!.gm.id);
  if (pairs.length !== 1) throw Error('Unique paired GM prerequisite failed');
  principal = { worldId: config.world, userId: baseline.gm.id, agentId: pairs[0]!.id };
  const nativeGateway = await browser.page.evaluate(() =>
    String((globalThis as any).game.settings.get('agent-gateway', 'gatewayUrl')),
  );
  const gatewayUrl = new URL(nativeGateway);
  const nativePort = Number(gatewayUrl.port || (gatewayUrl.protocol === 'wss:' ? 443 : 80));
  if (!['ws:', 'wss:'].includes(gatewayUrl.protocol) || nativePort !== config.linkPort)
    throw Error('Native gateway port differs from executor link port');
  for (let attempt = 0; ; attempt++) {
    try {
      livePrincipal();
      break;
    } catch (error) {
      if (attempt === 100) throw error;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  pinnedConnectionId = registry.get(principal.worldId, principal.userId)!.id;
  save('principal.json', {
    ...principal,
    linkPort: config.linkPort,
    live: true,
    announcedTools: ['token_manage', 'combat_manage', 'scene_control'],
  });
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
  await browser.page.evaluate(() => {
    const g = globalThis as any;
    const rows =
      JSON.parse(localStorage.getItem(`agent-gateway.${g.game.world.id}.approvalQueue`) ?? '{}')[
        g.game.user.id
      ] ?? [];
    if (
      !Array.isArray(rows) ||
      rows.some((r: any) => r.status === 'pending' || (r.status === 'approved' && !r.result))
    )
      throw Error('Existing pending/running GM request prevents isolated acceptance');
  });
  server = createSessionServer({
    version: '0.1.0',
    registry,
    selector: { world: config.world, user: principal!.userId },
    knownIdentities: () =>
      store
        .listActivePairings()
        .map((p) => ({ worldId: p.worldId, userId: p.userId, userName: p.userName })),
    log: () => {},
  });
  client = new Client({ name: 'task24-native', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  const listed = await client.listTools();
  if (
    ['token_manage', 'combat_manage', 'scene_control'].some(
      (name) => !listed.tools.some((t) => t.name === name),
    )
  )
    throw Error('Bound MCP session did not expose exact Task24 tools');
  livePrincipal();
  if (preflightOnly) {
    complete = true;
    cleaned = true;
    save('readonly-readiness.json', {
      source: TASK24_SOURCE,
      bundle: hash,
      principal,
      connectionId: pinnedConnectionId,
      linkPort: config.linkPort,
      noFixtures: true,
    });
  } else {
    const create = async (type: string, source: unknown) => {
      livePrincipal();
      const result = await browser!.page.evaluate(
        async ({ type, source, run, baselineRoots }) => {
          const g = globalThis as any;
          const d = await g.CONFIG[type].documentClass.create(source, { renderSheet: false });
          if (
            !d?.uuid ||
            d.documentName !== type ||
            d.parent ||
            d.flags?.world?.task24 !== run ||
            baselineRoots.includes(d.uuid) ||
            d.collection?.get?.(d.id) !== d
          )
            throw Error('Returned fixture identity is not fresh canonical nonce-owned root');
          return {
            uuid: d.uuid,
            children: [...(d.levels?.contents ?? [])].map((c: any) => ({
              id: c.id,
              uuid: c.uuid,
              name: c.name,
              elevation: c.elevation,
              parentUuid: c.parent?.uuid,
            })),
          };
        },
        { type, source, run, baselineRoots: baseline!.roots },
      );
      roots.push(result.uuid);
      created.push(result.uuid, ...result.children.map((c: any) => c.uuid));
      save('fixtures.json', { roots, created });
      return result;
    };
    ids.actor = (await create('Actor', data.actor)).uuid;
    const scene = await create('Scene', data.scene);
    ids.scene = scene.uuid;
    ids.level =
      generation === 14
        ? (scene.children.find(
            (c: any) =>
              c.name === `ag-task24-${run}-upper` &&
              c.elevation.bottom === 10 &&
              c.elevation.top === 20 &&
              c.parentUuid === ids.scene,
          )?.id ?? '')
        : 'unsupported-level';
    if (
      (generation === 14 && (scene.children.length !== 2 || !ids.level)) ||
      (generation === 13 && scene.children.length !== 0)
    )
      throw Error('Exact two fixture levels required');
    ids.combat = (await create('Combat', { ...data.combat, scene: ids.scene.split('.')[1] })).uuid;
    for (let index = 0; index < 16; index++) {
      if (index === 11) {
        const zero = await browser.page.evaluate(async (uuid) => {
          const c = await (globalThis as any).fromUuid(uuid);
          return (
            c.round === 1 &&
            c.turn === 0 &&
            c.turns.length === 2 &&
            c.getTimeDelta(1, 0, 1, 1) === 0
          );
        }, ids.combat);
        if (!zero) throw Error('Within-round zero-time fixture condition failed');
      }
      const audit = await step(index);
      if (index === 4 || index === 5) {
        const targets = audit.targets.filter(
          (t: any) => t.existed === false && t.uuid.startsWith(`${ids.scene}.Token.`),
        );
        if (targets.length !== 1) throw Error('Exact created token audit required');
        const uuid = targets[0].uuid;
        ids.tokens[index - 4] = uuid;
        created.push(uuid);
      }
      if (index === 7) {
        const rows = await browser.page.evaluate(async (uuid) => {
          const c = await (globalThis as any).fromUuid(uuid);
          return c.combatants.contents.map((d: any) => ({ uuid: d.uuid, tokenId: d.tokenId }));
        }, ids.combat);
        for (let i = 0; i < 2; i++) {
          const row = rows.find((r: any) => r.tokenId === ids.tokens[i]!.split('.').at(-1));
          if (!row) throw Error('Exact created combatant missing');
          ids.combatants[i] = row.uuid;
          created.push(row.uuid);
        }
      }
      const facts = await browser.page.evaluate(task24StepFacts, {
        index,
        ids,
        baseline,
        generation: generation as 13 | 14,
      });
      save(`facts-${index + 1}.json`, facts);
      if (index === 1)
        activationGuard = await browser.page.evaluate(
          (fixture) =>
            (globalThis as any).game.scenes.contents
              .filter((s: any) => s.uuid !== fixture)
              .map((s: any) => ({ uuid: s.uuid, source: s.toObject() })),
          ids.scene,
        );
      save('checkpoint.json', { ids, created, audits, activationGuard });
    }
    const facts = await browser.page.evaluate(
      async ({ ids, baseline }) => {
        const g = globalThis as any,
          s = await g.fromUuid(ids.scene);
        if (
          !s ||
          s.environment.darknessLevel !== 0.25 ||
          !s.active ||
          g.game.time.worldTime !== baseline.worldTime
        )
          throw Error('Scene/time final facts mismatch');
        for (const uuid of [...ids.tokens, ids.combat, ...ids.combatants])
          if (await g.fromUuid(uuid)) throw Error('Tool-deleted fixture remains');
        return {
          worldTimeUnchanged: true,
          darkness: s.environment.darknessLevel,
          active: s.active,
        };
      },
      { ids, baseline },
    );
    const finalRows = await auditRows();
    const currentAgent = principal!.agentId;
    const freshAgentRows = finalRows.filter(
      (r: any) =>
        !baseline!.audits.includes(r.uuid) &&
        r.agentId === currentAgent &&
        r.userId === baseline!.gm.id,
    );
    if (
      JSON.stringify(freshAgentRows.map((r: any) => r.uuid).sort()) !==
      JSON.stringify([...audits].sort())
    )
      throw Error('Final native audit set differs from exact fifteen calls');
    if (audits.length !== 15 || created.length !== (generation === 14 ? 9 : 7))
      throw Error('Native audit or fixture count mismatch');
    save('native-facts.json', {
      source: TASK24_SOURCE,
      bundle: hash,
      run,
      ids,
      created,
      audits,
      facts,
    });
    complete = true;
  }
} finally {
  try {
    if (browser && baseline && roots.length > 0)
      await prepareNativeCleanup({
        baselineCaptured: true,
        settle: async () => {
          await Promise.all(outstanding);
        },
        drain: async () => {
          if (dispatched.some((r) => !r.terminal))
            throw Error('Unproven execution terminality: manual reconciliation');
          for (const record of dispatched.filter((r) => r.spec.audit && !r.denied)) {
            let observed: any;
            for (let attempt = 0; attempt <= 100; attempt++) {
              try {
                const rows = await auditRows();
                const identity = {
                  userId: baseline!.gm.id,
                  agentId: principal!.agentId,
                };
                observed = record.audit
                  ? capturedCallAudit(rows, record.baseline, identity, record.spec, record.audit)
                  : freshCallAudit(rows, record.baseline, identity, record.spec, false);
                if (record.audit) assertTask24Audit(observed, record.spec);
                break;
              } catch (error) {
                if (attempt === 100) throw error;
                await new Promise((r) => setTimeout(r, 100));
              }
            }
            if (!audits.includes(observed.uuid)) audits.push(observed.uuid);
          }
        },
        assertNoReservation: async () => {
          const queue = await browser!.page.evaluate(() => {
            const g = globalThis as any;
            return (
              JSON.parse(
                localStorage.getItem(`agent-gateway.${g.game.world.id}.approvalQueue`) ?? '{}',
              )[g.game.user.id] ?? []
            );
          });
          assertTask24Terminal(dispatched, queue);
        },
        invalidatePending: async () => {},
        discover: async () => {
          const recovered = await browser!.page.evaluate(
            ({ run, baseline }) => {
              const g = globalThis as any;
              return [
                ...g.game.actors.contents,
                ...g.game.scenes.contents,
                ...g.game.combats.contents,
              ]
                .filter(
                  (d: any) => d.flags?.world?.task24 === run && !baseline.roots.includes(d.uuid),
                )
                .map((d: any) => ({
                  uuid: d.uuid,
                  children: [
                    ...(d.tokens?.contents ?? []),
                    ...(d.levels?.contents ?? []),
                    ...(d.combatants?.contents ?? []),
                  ].map((c: any) => c.uuid),
                }));
            },
            { run, baseline: baseline! },
          );
          for (const row of recovered) {
            if (!roots.includes(row.uuid)) roots.push(row.uuid);
            for (const uuid of [row.uuid, ...row.children])
              if (!created.includes(uuid)) created.push(uuid);
          }
        },
        remove: async () => {
          const activation = await browser!.page.evaluate((fixture) => {
            const g = globalThis as any;
            return {
              current: g.game.scenes.contents.filter((s: any) => s.active).map((s: any) => s.uuid),
              currentSources: g.game.scenes.contents
                .filter((s: any) => s.uuid !== fixture)
                .map((s: any) => ({ uuid: s.uuid, source: s.toObject() })),
            };
          }, ids.scene);
          if (activation.current.includes(ids.scene)) {
            if (!activationGuard) throw Error('Activation custody unproven');
            assertTask24Activation({ fixture: ids.scene, saved: activationGuard, ...activation });
          } else if (
            JSON.stringify([...activation.current].sort()) !==
            JSON.stringify([...baseline!.activeScenes].sort())
          )
            throw Error('External activation requires manual reconciliation');
          await browser!.page.evaluate(task24RemoveFixtures, {
            roots,
            run,
            baseline: baseline!,
            activationGuard,
          });
          const readback = await browser!.page.evaluate(
            async ({ created, audits, baseline }) => {
              const g = globalThis as any;
              for (const uuid of created)
                if (await g.fromUuid(uuid)) throw Error('Fixture remains after cleanup');
              for (const uuid of audits)
                if (!(await g.fromUuid(uuid))) throw Error('Audit disappeared');
              if (
                g.game.time.worldTime !== baseline.worldTime ||
                g.game.combats.contents.length ||
                (g.canvas.level?.id ?? null) !== baseline.view.levelId ||
                (g.ui.combat.viewed?.uuid ?? null) !== baseline.view.combatUuid ||
                JSON.stringify([...g.game.user.targets].map((t: any) => t.id).sort()) !==
                  JSON.stringify([...baseline.view.targets].sort()) ||
                (g.canvas.scene?.id !== baseline.view.sceneId &&
                  !(g.canvas.scene === null && baseline.view.sceneId === null))
              )
                throw Error('Original time/view/combat state not restored');
              const rootsAfter = [
                ...g.game.actors.contents,
                ...g.game.scenes.contents,
                ...g.game.combats.contents,
              ]
                .map((d: any) => d.uuid)
                .sort();
              if (JSON.stringify(rootsAfter) !== JSON.stringify([...baseline.roots].sort()))
                throw Error('Original root identities changed');
              for (const saved of baseline.actorSources) {
                const actor = await g.fromUuid(saved.uuid);
                if (!actor || JSON.stringify(actor.toObject()) !== JSON.stringify(saved.source))
                  throw Error('Original Actor source changed');
              }
              for (const saved of baseline.sceneSources) {
                const scene = await g.fromUuid(saved.uuid);
                const before = { ...saved.source };
                delete before._stats;
                const after = scene?.toObject();
                if (after) delete after._stats;
                if (!scene || JSON.stringify(after) !== JSON.stringify(before))
                  throw Error('Original Scene ordinary source changed');
              }
              const active = g.game.scenes.contents
                .filter((s: any) => s.active)
                .map((s: any) => s.uuid)
                .sort();
              if (JSON.stringify(active) !== JSON.stringify([...baseline.activeScenes].sort()))
                throw Error('Original active scenes not restored');
              if (
                g.game.user?.id !== baseline.gm.id ||
                !g.game.user.isGM ||
                g.game.users.activeGM?.id !== baseline.gm.id ||
                g.game.users.contents.some(
                  (u: any) => u.active && u.isGM && u.id !== baseline.gm.id,
                )
              )
                throw Error('Cleanup GM authority/isolation changed');
              return {
                absent: created.length,
                retained: audits.length,
                timeUnchanged: true,
                viewsRestored: true,
              };
            },
            { created, audits, baseline: baseline! },
          );
          save('cleanup.json', readback);
          cleaned = true;
          console.log(`[task24] CLEAN v${generation} ${JSON.stringify(readback)}`);
        },
      });
  } catch (error) {
    save('cleanup-failure.json', { message: String(error), roots, created, audits });
    console.error(`[task24] MANUAL RECONCILIATION REQUIRED ${String(error)}`);
  }
  await client?.close();
  await server?.close();
  await browser?.context.close();
  await link.close();
  store.close();
}
if (!complete || !cleaned)
  throw Error('Native Task24 acceptance incomplete; inspect private evidence');
if (preflightOnly)
  console.log(
    `[task24] READONLY READY v${generation} source=${TASK24_SOURCE} bundle=${hash} evidence=${evidence} noFixtures=true`,
  );
else
  console.log(
    `[task24] COMPLETE v${generation} source=${TASK24_SOURCE} bundle=${hash} evidence=${evidence}`,
  );
