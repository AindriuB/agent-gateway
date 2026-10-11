import { nativeObserverScript } from './native-observer-script.js';
import { assertNativeBundleHash, nativeDestructivePolicy } from './native-plan.js';
/* eslint-disable @typescript-eslint/no-explicit-any */
/** Native task23 acceptance; run manually with node --import tsx after npm run build.
 * Requires GENERATION=v13|v14, EXPECTED_BUNDLE_SHA=<reviewed hash>, and
 * APPROVED=exact-fixtures-and-cleanup (all prefixed AGENT_GATEWAY_TASK23_).
 * Set approval only after a human authorizes the eight calls/five docs/one Undo/cleanup plan.
 * This program never clicks approval or Undo controls. Evidence stays local under /private/tmp.
 * RESUME is optional v14 zero-MCP recovery, requiring fresh native-reconcile custody validation
 * and separate human authorization. Never reuse a completed or partially restored entry.
 */
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
import { readNativeReadiness } from '../player-tokens-combat/native-readiness.js';
import { waitForNativeApprovals } from '../player-tokens-combat/native-approval.js';
import { discoverNativeFixtures, prepareNativeCleanup } from './native-lifecycle.js';
import { retainNativeAudit } from '../player-tokens-combat/native-lifecycle.js';
import {
  assertNativeResumeCheckpoint,
  assertNativeApprovalCards,
  assertNativeUpdateDiff,
  nativeDocumentPlan,
  returnedDocumentUuid,
  undoComparable,
  TASK23_SOURCE,
} from './native-plan.js';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const { config, paths } = loadContext();
const version = process.env.AGENT_GATEWAY_TASK23_GENERATION;
if (config.world !== 'test-world' || (version !== 'v13' && version !== 'v14'))
  throw Error('Select a prepared test-world generation');
const approved = process.env.AGENT_GATEWAY_TASK23_APPROVED === 'exact-fixtures-and-cleanup';
if (!approved)
  throw Error(
    'The operator must approve the exact task23 fixtures and cleanup before this harness runs',
  );
const startedAt = Date.now();
const resumePath = process.env.AGENT_GATEWAY_TASK23_RESUME;
const resumeCheckpoint = resumePath ? JSON.parse(readFileSync(resumePath, 'utf8')) : undefined;
if (resumeCheckpoint) assertNativeResumeCheckpoint(resumeCheckpoint);
const fixtureRun = resumeCheckpoint?.fixtureRun ?? randomBytes(6).toString('hex');
const evidence = resolve(
  '/private/tmp',
  `task23-native-${version}-${fixtureRun}${resumeCheckpoint ? `-resume-${randomBytes(3).toString('hex')}` : ''}`,
);
mkdirSync(evidence, { recursive: true });
const bundle = readFileSync(resolve(root, 'dist/module/main.js'));
const sha = createHash('sha256').update(bundle).digest('hex');
assertNativeBundleHash(sha, process.env.AGENT_GATEWAY_TASK23_EXPECTED_BUNDLE_SHA);
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
const created: string[] = [];
let originalCombats: Array<{ uuid: string; active: boolean; round: number; turn: number | null }> =
  [];
let originalView: unknown;
let originalWorldTime: number | undefined;
let complete = false;
let cleaned = false;
let undoAuditUuid: string | undefined;
let baselineRoots: string[] = [];
let baselineCaptured = false;
let unsafeCleanup = false;
const approvalIds: string[] = [];
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
  writeFileSync(
    resolve(evidence, 'checkpoint-audit.json'),
    JSON.stringify({ retainedAuditUuids, completedAuditKeys, rows }, null, 2),
  );
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
  const client = new Client({ name: 'task23-native-acceptance', version: '0.0.0-test' });
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
      approvalIds.push(id);
      console.log(
        `[task23] PENDING ${version} ${name}: status=pending_approval idPresent=${typeof id === 'string'} at=${new Date().toISOString()}`,
      );
      for (let i = 0; i < 600; i++) {
        const status = await call('approval_status', { id });
        if (status.isError || ['denied', 'expired'].includes(status.structured?.status))
          throw Error(`${name} approval failed: ${status.text}`);
        if (status.structured?.result !== undefined) {
          console.log(
            `[task23] POLL ${version} ${name}: completed resultPresent=true at=${new Date().toISOString()}`,
          );
          result = {
            isError: status.structured.resultFailed === true,
            text: status.structured.result,
            structured: undefined,
          };
          break;
        }
        await new Promise((done) => setTimeout(done, 1000));
        if (i === 599) throw Error(`Timed out waiting for human approval of ${name}`);
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
      console.log(`[task23] NATIVE ${version} ${text}`);
  });
  let servedBundle = false;
  for (const template of ['approval/approval', 'audit/audit'])
    await browser.context.route(`**/modules/agent-gateway/templates/${template}.hbs*`, (route) =>
      route.fulfill({
        path: resolve(root, `templates/${template}.hbs`),
        contentType: 'text/plain',
      }),
    );
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
  const rawPolicy = await browser.page.evaluate(() =>
    (globalThis as any).game.settings.get('agent-gateway', 'worldPolicy'),
  );
  const policy = readNativeWritePolicy(rawPolicy);
  if (nativeDestructivePolicy(rawPolicy) !== 'ask_owner')
    throw Error('GM destructive policy must require owner approval');
  if (policy.gm !== 'ask_owner' || policy.player !== 'ask_owner')
    throw Error('World policy differs from the approved default owner-approval test plan');
  for (const template of ['approval/approval', 'audit/audit']) {
    const path = `modules/agent-gateway/templates/${template}.hbs`;
    const source = readFileSync(resolve(root, `templates/${template}.hbs`), 'utf8');
    await browser.page.evaluate(
      ({ source, path }) => {
        const g = globalThis as any;
        g.Handlebars.registerPartial(path, g.Handlebars.compile(source, { preventIndent: true }));
        if (typeof g.Handlebars.partials[path] !== 'function')
          throw Error('Verified native partial was not cached');
      },
      { source, path },
    );
    console.log(
      `[task23] TEMPLATE ${version}: path=${path} sha=${createHash('sha256').update(source).digest('hex')} nativePartialCached=true`,
    );
  }
  return browser;
}
const plan = nativeDocumentPlan(fixtureRun);
const roots: string[] = [];
let rootSnapshots: unknown[] = [];
async function group(
  label: string,
  specs: Array<{ name: string; args: Record<string, unknown>; type?: string; parent?: string }>,
  owner: Awaited<ReturnType<typeof session>>,
) {
  const batch = startLiveBatch(
    specs.map(async (spec) => {
      const result = await owner.approvedCall(spec.name, spec.args);
      if (spec.type) {
        const uuid = returnedDocumentUuid(result, spec.type, spec.parent);
        created.push(uuid);
        if (!spec.parent) roots.push(uuid);
        writeFileSync(
          resolve(evidence, 'checkpoint-created.json'),
          JSON.stringify({ fixtureRun, created, roots }, null, 2),
        );
      }
      return result;
    }),
  );
  outstandingBatches.push(batch.settled);
  await waitForNativeApprovals(gmBrowser!.page, specs.length);
  const visibleCards = await gmBrowser!.page
    .locator('article[data-request]')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        id: (element as HTMLElement).dataset.request!,
        tool: element.querySelector('h3')!.textContent!.trim(),
        args: JSON.parse(element.querySelector('.ag-approval-payload')!.textContent!),
      })),
    );
  assertNativeApprovalCards(visibleCards, specs);
  for (const card of visibleCards) if (!approvalIds.includes(card.id)) approvalIds.push(card.id);
  writeFileSync(
    resolve(evidence, `${label}-rendered-requests.json`),
    JSON.stringify(visibleCards, null, 2),
  );
  if (label === 'updates') {
    const cards = await gmBrowser!.page.locator('article[data-request]').evaluateAll((elements) =>
      elements.map((element) => {
        const args = JSON.parse(element.querySelector('.ag-approval-payload')!.textContent!);
        return {
          tool: element.querySelector('h3')!.textContent!.trim(),
          uuid: args.uuid,
          rows: [...element.querySelectorAll('tbody tr')].map((row) => {
            const cells = row.querySelectorAll('td');
            return {
              path: cells[0]!.textContent!.trim(),
              before: cells[1]!.textContent!.trim(),
              after: cells[2]!.textContent!.trim(),
            };
          }),
        };
      }),
    );
    assertNativeUpdateDiff(cards, {
      actor: specs[0]!.args.uuid as string,
      page: specs[1]!.args.uuid as string,
      run: fixtureRun,
    });
    writeFileSync(resolve(evidence, 'native-update-diff.json'), JSON.stringify(cards, null, 2));
  }
  await gmBrowser!.page.bringToFront();
  await gmBrowser!.page.screenshot({ path: resolve(evidence, `${label}-approval.png`) });
  console.log(
    `[task23] READY ${version} ${config.gmUser} ${label}: ${specs.length} requests; human approval required`,
  );
  return batch.result(drainAudit);
}
try {
  gmBrowser = await open(config.gmUser);
  const preflight = await gmBrowser.page.evaluate(readNativeReadiness, {
    playerName: config.playerUser,
    version,
  });
  originalWorldTime = preflight.worldTime;
  originalCombats = await gmBrowser.page.evaluate(() =>
    (globalThis as any).game.combats.contents.map((c: any) => ({
      uuid: c.uuid,
      active: c.active,
      round: c.round,
      turn: c.turn,
    })),
  );
  originalView = await gmBrowser.page.evaluate(() => {
    const g = globalThis as any;
    return {
      scene: g.canvas.scene?.id ?? null,
      combat: g.ui.combat.viewed?.uuid ?? null,
      targets: [...g.game.user.targets].map((t: any) => t.id).sort(),
    };
  });
  auditBaseline = await gmBrowser.page.evaluate(() => {
    const g = (globalThis as any).game;
    return g.journal
      .get(g.settings.get('agent-gateway', 'auditJournalId'))
      .pages.contents.map((p: any) => p.uuid);
  });
  const freshSource = await gmBrowser.page.evaluate(async (uuid) => {
    const g = globalThis as any;
    const d = await g.fromUuid(uuid);
    if (
      !d ||
      d.documentName !== 'Item' ||
      d.name !== 'Dagger' ||
      (d.effects?.size ?? 0) !== 0 ||
      d.flags?.['agent-gateway']
    )
      throw Error('Readonly compendium source prerequisite changed');
    return { uuid: d.uuid, source: d.toObject() };
  }, TASK23_SOURCE);
  const source = resumeCheckpoint?.originalSource ?? freshSource;
  if (resumeCheckpoint?.originalSource && JSON.stringify(source) !== JSON.stringify(freshSource))
    throw Error('Original durable compendium source changed before resume');
  if (resumeCheckpoint?.originalBaselines) {
    const b = resumeCheckpoint.originalBaselines;
    if (
      originalWorldTime !== b.originalWorldTime ||
      JSON.stringify(originalCombats) !== JSON.stringify(b.originalCombats) ||
      JSON.stringify(originalView) !== JSON.stringify(b.originalView)
    )
      throw Error('Original world baseline changed before resume');
    auditBaseline = b.auditBaseline;
  }
  await gmBrowser.page.evaluate(() => {
    const g = globalThis as any;
    const records =
      JSON.parse(localStorage.getItem(`agent-gateway.${g.game.world.id}.approvalQueue`) ?? '{}')[
        g.game.user.id
      ] ?? [];
    if (records.some((r: any) => r.status === 'pending' || (r.status === 'approved' && !r.result)))
      throw Error('Existing pending/running GM request: isolate before acceptance');
  });
  baselineRoots = await gmBrowser.page.evaluate((prefix) => {
    const g = globalThis as any;
    const roots = [...g.game.actors.contents, ...g.game.journal.contents, ...g.game.items.contents];
    if (roots.some((d: any) => d.name?.startsWith(prefix))) throw Error('Fixture nonce collision');
    return roots.map((d: any) => d.uuid);
  }, plan.prefix);
  if (resumeCheckpoint?.originalBaselines)
    baselineRoots = resumeCheckpoint.originalBaselines.baselineRoots;
  baselineCaptured = true;
  writeFileSync(
    resolve(evidence, 'checkpoint-before-calls.json'),
    JSON.stringify(
      {
        fixtureRun,
        version,
        sha,
        preflight,
        baselineRoots,
        auditBaseline,
        source,
        originalCombats,
        originalView,
        originalWorldTime,
        originalSourceUnavailable: resumeCheckpoint?.originalSourceUnavailable ?? false,
      },
      null,
      2,
    ),
  );
  let beforeDelete: any[] = [];
  if (!resumeCheckpoint) {
    const owner = await session(preflight.gm.name, preflight.gm.id);
    await owner.client.listTools();
    console.log(
      `[task23] PREFLIGHT ${version}: source=${source.uuid} bundle=${sha} generation=${preflight.foundryVersion}`,
    );
    await group(
      'roots',
      [
        {
          name: 'document_create',
          args: { type: 'Actor', data: JSON.stringify(plan.actor) },
          type: 'Actor',
        },
        {
          name: 'document_create',
          args: { type: 'JournalEntry', data: JSON.stringify(plan.journal) },
          type: 'JournalEntry',
        },
        { name: 'compendium_import', args: { uuid: TASK23_SOURCE }, type: 'Item' },
      ],
      owner,
    );
    const actor = roots.find((uuid) => uuid.startsWith('Actor.'))!;
    const journal = roots.find((uuid) => uuid.startsWith('JournalEntry.'))!;
    await group(
      'children',
      [
        {
          name: 'document_create',
          args: { type: 'ActiveEffect', parentUuid: actor, data: JSON.stringify(plan.effect) },
          type: 'ActiveEffect',
          parent: actor,
        },
        {
          name: 'document_create',
          args: { type: 'JournalEntryPage', parentUuid: journal, data: JSON.stringify(plan.page) },
          type: 'JournalEntryPage',
          parent: journal,
        },
      ],
      owner,
    );
    const page = created.find((uuid) => uuid.includes('.JournalEntryPage.'))!;
    await group(
      'updates',
      [
        {
          name: 'document_update',
          args: { uuid: actor, update: JSON.stringify(plan.actorUpdate) },
        },
        { name: 'document_update', args: { uuid: page, update: JSON.stringify(plan.pageUpdate) } },
      ],
      owner,
    );
    beforeDelete = await gmBrowser.page.evaluate(
      async ({ roots, actor, page, plan, created }) => {
        const g = globalThis as any;
        const a = await g.fromUuid(actor),
          p = await g.fromUuid(page);
        if (
          a.name !== plan.actorUpdate.name ||
          a.flags.world.task23.phase !== 'updated' ||
          'obsolete' in a.flags.world.task23 ||
          p.text.content !== plan.pageUpdate.text.content
        )
          throw Error('Native update did not persist');
        if (a.getActiveTokens().length !== 0)
          throw Error('Disposable dead-status NPC unexpectedly has tokens');
        for (const uuid of created)
          if (!(await g.fromUuid(uuid))) throw Error('Created fixture missing');
        const snapshots = [];
        for (const uuid of roots) snapshots.push((await g.fromUuid(uuid)).toObject());
        return snapshots;
      },
      { roots, actor, page, plan, created },
    );
    rootSnapshots = beforeDelete;
    await group('group-delete', [{ name: 'document_delete', args: { uuids: roots } }], owner);
  } else {
    if (version !== 'v14' || preflight.gm.id !== resumeCheckpoint.userId)
      throw Error('Resume must use the same v14 GM identity');
    created.push(...resumeCheckpoint.created);
    roots.push(...resumeCheckpoint.roots);
    retainedAuditUuids.push(...resumeCheckpoint.audits.map((row: any) => row.uuid));
    beforeDelete = resumeCheckpoint.snapshots;
    rootSnapshots = beforeDelete;
    console.log(
      `[task23] RESUME ${version}: eight prior successful calls; no MCP replay; original compendium custody checked when available`,
    );
  }
  writeFileSync(
    resolve(evidence, 'checkpoint-before-undo.json'),
    JSON.stringify(
      {
        fixtureRun,
        version,
        sha,
        created,
        roots,
        beforeDelete,
        retainedAuditUuids,
        source,
        originalSourceUnavailable: resumeCheckpoint?.originalSourceUnavailable ?? false,
      },
      null,
      2,
    ),
  );
  const deleteAudit = await gmBrowser.page.evaluate(
    async ({ created, retained, roots, snapshots, resumeAudit, expectedAgentId }) => {
      const g = globalThis as any;
      for (const uuid of created)
        if (await g.fromUuid(uuid)) throw Error('Grouped native delete left a fixture');
      const pages = await Promise.all(retained.map(async (uuid) => await g.fromUuid(uuid)));
      const p = pages.find((p) => p.system.tool === 'document_delete');
      if (
        !p ||
        p.system.targets.length !== 3 ||
        p.system.targets.some((t: any) => !t.undoable || !t.existed)
      )
        throw Error('Grouped deletion has no trusted root Undo targets');
      if (resumeAudit && p.uuid !== resumeAudit)
        throw Error('Resume deletion audit identity changed');
      for (let i = 0; i < roots.length; i++) {
        const target = p.system.targets.find((t: any) => t.uuid === roots[i]);
        if (!target || JSON.stringify(JSON.parse(target.before)) !== JSON.stringify(snapshots[i]))
          throw Error('Fresh trusted root snapshot differs from resume checkpoint');
      }
      if (
        p.system.undoneAt ||
        p.system.undoCompleted.length ||
        p.parent.pages.contents.some(
          (row: any) => row.flags?.['agent-gateway']?.undoReservation?.entry === p.uuid,
        )
      )
        throw Error('Native Undo entry already completed or reserved');
      const createdTargets = pages
        .filter((row: any) => ['document_create', 'compendium_import'].includes(row.system.tool))
        .flatMap((row: any) =>
          row.system.targets.filter((t: any) => t.existed === false).map((t: any) => t.uuid),
        );
      if (
        JSON.stringify([...createdTargets].sort()) !== JSON.stringify([...created].sort()) ||
        pages.length !== 8 ||
        pages.some(
          (row: any) =>
            row.system.status !== 'ok' ||
            row.system.userId !== g.game.user.id ||
            row.system.agentId !== (expectedAgentId ?? pages[0].system.agentId) ||
            row.system.relayed,
        )
      )
        throw Error('Fresh exact eight-audit creation identities differ');
      const Menu = g.game.settings.menus.get('agent-gateway.audit')?.type;
      if (!Menu) throw Error('Native audit menu is unavailable');
      await new Menu().render({ force: true });
      return { uuid: p.uuid, id: p.id };
    },
    {
      created,
      retained: retainedAuditUuids,
      roots,
      snapshots: beforeDelete,
      resumeAudit: resumeCheckpoint?.deleteAudit.uuid,
      expectedAgentId: resumeCheckpoint?.agentId,
    },
  );
  undoAuditUuid = deleteAudit.uuid;
  const rawTarget = await gmBrowser.page.evaluate(
    ({ uuid, roots }) => {
      const g = globalThis as any;
      return {
        journalUuid: g.game.journal.get(g.game.settings.get('agent-gateway', 'auditJournalId'))
          .uuid,
        pageId: uuid.split('.').at(-1),
        gmId: g.game.user.id,
        roots,
      };
    },
    { uuid: deleteAudit.uuid, roots },
  );
  await gmBrowser.page.evaluate(nativeObserverScript(rawTarget));

  const undoControl = gmBrowser.page.locator(
    `#agent-gateway-audit button[data-action="undo"][data-page-id="${deleteAudit.id}"]`,
  );
  await undoControl.waitFor({ state: 'visible', timeout: 15000 });
  await gmBrowser.page.bringToFront();
  await gmBrowser.page.screenshot({ path: resolve(evidence, 'undo-ready.png') });
  console.log(
    `[task23] READY ${version} ${config.gmUser} native Undo: one grouped delete entry; human click required`,
  );
  const deadline = Date.now() + 600000;
  let rawComplete = false;
  while (Date.now() < deadline) {
    const raw = await gmBrowser.page.evaluate(async () => {
      const observer = (globalThis as any).__task23AuditProgress;
      try {
        await observer.drain();
        await observer.read();
      } catch {
        return { ...observer.snapshot(), complete: false, readError: true };
      }
      return { ...observer.snapshot(), complete: Boolean(observer.complete()), readError: false };
    });
    writeFileSync(
      resolve(evidence, 'checkpoint-raw-undo-progress.json'),
      JSON.stringify(raw, null, 2),
    );
    if (raw.readError || raw.failed)
      throw Error('Raw native audit sensor failed; private checkpoint retained');
    if (raw.complete) {
      rawComplete = true;
      break;
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  if (!rawComplete) throw Error('Raw native Undo completion did not persist');
  const afterUndo = await gmBrowser.page.evaluate(
    async ({ roots, created, retained }) => {
      const g = globalThis as any;
      for (const uuid of created)
        if (!(await g.fromUuid(uuid)))
          throw Error('Native Undo failed exact root/child identity restoration');
      const snapshots = [];
      for (const uuid of roots) snapshots.push((await g.fromUuid(uuid)).toObject());
      const audit = [];
      const sourceAfter = (
        await g.fromUuid('Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z')
      ).toObject();
      for (const uuid of retained) audit.push({ uuid, system: (await g.fromUuid(uuid)).system });
      if (audit.length !== 8 || audit.some((row) => row.system.status !== 'ok'))
        throw Error('Eight successful audit entries not retained');
      const deletion = audit.find((row) => row.system.tool === 'document_delete');
      if (
        !deletion?.system.undoneAt ||
        deletion.system.undoneBy !== g.game.user.id ||
        JSON.stringify([...deletion.system.undoCompleted].sort()) !==
          JSON.stringify([...roots].sort())
      )
        throw Error('Native Undo completion does not name all three root targets');
      const journal = g.game.journal.get(g.game.settings.get('agent-gateway', 'auditJournalId'));
      if (
        journal.pages.contents.some(
          (p: any) => p.flags?.['agent-gateway']?.undoReservation?.entry === deletion.uuid,
        )
      )
        throw Error('Native Undo reservation remains live');
      return { snapshots, audit, sourceAfter };
    },
    { roots, created, retained: retainedAuditUuids },
  );
  if (
    JSON.stringify(undoComparable(rootSnapshots)) !==
    JSON.stringify(undoComparable(afterUndo.snapshots))
  )
    throw Error('Native Undo restored different root/embedded content');
  if (JSON.stringify(source.source) !== JSON.stringify(afterUndo.sourceAfter))
    throw Error('Compendium source was modified');
  writeFileSync(
    resolve(evidence, 'native-facts.json'),
    JSON.stringify(
      {
        fixtureRun,
        version,
        sha,
        preflight,
        created,
        roots,
        beforeDelete,
        afterUndo,
        source,
        originalSourceUnavailable: resumeCheckpoint?.originalSourceUnavailable ?? false,
      },
      null,
      2,
    ),
  );
  const rawFinal = await gmBrowser.page.evaluate(async () => {
    const observer = (globalThis as any).__task23AuditProgress;
    let readError = false;
    try {
      await observer.drain();
      await observer.read();
    } catch {
      readError = true;
    }
    const result = { ...observer.snapshot(), readError, complete: Boolean(observer.complete()) };
    observer.stop();
    return result;
  });
  writeFileSync(
    resolve(evidence, 'checkpoint-raw-undo-final.json'),
    JSON.stringify(rawFinal, null, 2),
  );
  if (rawFinal.readError || rawFinal.failed || !rawFinal.complete)
    throw Error('Raw completion regressed before acceptance; private checkpoint retained');
  await gmBrowser.page.screenshot({ path: resolve(evidence, 'undo-complete.png') });
  complete = true;
} finally {
  if (gmBrowser)
    await gmBrowser.page
      .evaluate(async () => {
        const observer = (globalThis as any).__task23AuditProgress;
        try {
          await observer?.drain();
        } finally {
          observer?.stop();
        }
      })
      .catch(() => {});
  if (gmBrowser)
    try {
      await prepareNativeCleanup({
        baselineCaptured,
        settle: async () => {
          await Promise.all(outstandingBatches);
        },
        drain: async () => {
          try {
            await drainAudit();
          } catch (error) {
            console.error(`[task23] audit drain: ${String(error)}`);
          }
        },
        assertNoReservation: async () => {
          await gmBrowser!.page.evaluate(
            ({ undoAuditUuid, approvalIds, startedAt }) => {
              const g = globalThis as any;
              const journal = g.game.journal.get(
                g.game.settings.get('agent-gateway', 'auditJournalId'),
              );
              if (
                undoAuditUuid &&
                journal.pages.contents.some(
                  (p: any) => p.flags?.['agent-gateway']?.undoReservation?.entry === undoAuditUuid,
                )
              )
                throw Error(
                  'Live Undo reservation: stop and request human recovery, do not delete fixtures',
                );
              const records =
                JSON.parse(
                  localStorage.getItem(`agent-gateway.${g.game.world.id}.approvalQueue`) ?? '{}',
                )[g.game.user.id] ?? [];
              if (
                records.some(
                  (r: any) =>
                    (approvalIds.includes(r.id) || r.createdAt >= startedAt) &&
                    r.status === 'approved' &&
                    !r.result,
                )
              )
                throw Error('Approved native call still executing: stop before cleanup');
            },
            { undoAuditUuid, approvalIds, startedAt },
          );
        },
        invalidatePending: async () => {
          if (!complete && outstandingBatches.length) {
            await gmBrowser!.page.reload();
            await gmBrowser!.page.waitForFunction('globalThis.game?.ready===true');
          }
        },
        discover: async () => {
          const discovered = await gmBrowser!.page.evaluate(discoverNativeFixtures, {
            prefix: plan.prefix,
            retained: retainedAuditUuids,
          });
          for (const uuid of discovered) {
            if (baselineRoots.includes(uuid))
              throw Error('Recovered fixture was present before this run');
            if (!created.includes(uuid)) created.push(uuid);
            if (uuid.split('.').length === 2 && !roots.includes(uuid)) roots.push(uuid);
          }
        },
        remove: async () => {
          const unknownItems = await gmBrowser!.page.evaluate(
            ({ baseline, created }) =>
              (globalThis as any).game.items.contents
                .filter((d: any) => !baseline.includes(d.uuid) && !created.includes(d.uuid))
                .map((d: any) => d.uuid),
            { baseline: baselineRoots, created },
          );
          if (unknownItems.length)
            throw Error(
              'Untracked new Item: cleanup requires exact audit/result reconciliation, never delete by name',
            );
        },
      });
      for (const uuid of [...roots].reverse()) {
        if (baselineRoots.includes(uuid)) throw Error('Refuse cleanup of a preexisting root');
        await gmBrowser.page.evaluate(
          async ({ uuid, prefix }) => {
            const g = globalThis as any;
            const d = await g.fromUuid(uuid);
            if (!d) return;
            if (!(d.documentName === 'Item' && d.name === 'Dagger') && !d.name.startsWith(prefix))
              throw Error('Exact fixture cleanup provenance mismatch');
            await d.delete();
          },
          { uuid, prefix: plan.prefix },
        );
      }
      const readback = await gmBrowser.page.evaluate(
        async ({ created, retained, originalCombats, worldTime, originalView }) => {
          const g = globalThis as any;
          for (const uuid of created)
            if (await g.fromUuid(uuid)) throw Error('Fixture remains after cleanup');
          for (const uuid of retained)
            if (!(await g.fromUuid(uuid))) throw Error('Retained audit disappeared');
          for (const before of originalCombats) {
            const now = await g.fromUuid(before.uuid);
            if (
              !now ||
              now.active !== before.active ||
              now.round !== before.round ||
              now.turn !== before.turn
            )
              throw Error('Unrelated combat changed');
          }
          if (worldTime !== undefined && g.game.time.worldTime !== worldTime)
            throw Error('Unrelated world time changed');
          const view = {
            scene: g.canvas.scene?.id ?? null,
            combat: g.ui.combat.viewed?.uuid ?? null,
            targets: [...g.game.user.targets].map((t: any) => t.id).sort(),
          };
          if (originalView && JSON.stringify(view) !== JSON.stringify(originalView))
            throw Error('Unrelated personal view/targets changed');
          return {
            absent: created.length,
            retained: retained.length,
            originalCombatsUnchanged: originalCombats.length,
            worldTimeUnchanged: true,
            personalViewsUnchanged: true,
            foundryVersion: g.game.version,
          };
        },
        {
          created,
          retained: retainedAuditUuids,
          originalCombats,
          worldTime: originalWorldTime,
          originalView,
        },
      );
      writeFileSync(resolve(evidence, 'cleanup.json'), JSON.stringify(readback, null, 2));
      cleaned = true;
      console.log(`[task23] CLEAN ${version}: ${JSON.stringify(readback)}`);
    } catch (error) {
      unsafeCleanup = true;
      console.error(
        `[task23] CLEANUP FAILED ${version}: ${String(error)}; preserve controlled GM for human recovery`,
      );
    }
  for (const { client, server } of sessions) {
    await client.close();
    await server.close();
  }
  for (const browser of browsers) if (!unsafeCleanup) await browser.context.close();
  await link.close();
  store.close();
}
if (!complete || !cleaned) throw Error('Native task23 acceptance or exact cleanup failed');
console.log(`[task23] COMPLETE ${version} bundle=${sha} evidence=${evidence}`);
