/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Explicit, human-approved native write acceptance. No approval button is clicked by this harness.
 * Run one configured instance at a time after the GM approves the exact fixture plan and cleanup.
 * Uses the production module bundle, real MCP/link, default policy and native owner approval UI.
 */
import {
  startLiveBatch,
  waitForLiveAudit,
  readNativeAuditRows,
  liveAuditKey,
} from './live-settlement.js';
import { readNativeWritePolicy } from './live-policy.js';
import { readFileSync, mkdirSync } from 'node:fs';
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

if (process.env.AGENT_GATEWAY_TASK21_APPROVED !== 'exact-fixtures-and-cleanup')
  throw Error('The human approver must first approve the exact task 21 fixture writes and cleanup');
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const { config, paths } = loadContext();
if (config.world !== 'test-world') throw Error('Only the prepared fixture world is authorized');
const version = process.env.AGENT_GATEWAY_TASK21_GENERATION;
if (version !== 'v13' && version !== 'v14')
  throw Error('Set the explicitly approved fixture generation');
const fixtureRun = randomBytes(6).toString('hex');
const roleSelection = process.env.AGENT_GATEWAY_TASK21_ROLES ?? 'all';
if (roleSelection !== 'all' && roleSelection !== 'player')
  throw Error('Only all or player roles are supported');
const roles: Array<'gm' | 'player'> = roleSelection === 'player' ? ['player'] : ['gm', 'player'];
const journalId = version === 'v13' ? 'ag21v13writes001' : 'ag21v14writes001';
const journalUuid = `JournalEntry.${journalId}`;
const bundle = readFileSync(resolve(root, 'dist/module/main.js'));
const sha = createHash('sha256').update(bundle).digest('hex');
const evidence = resolve(root, 'module/test/tools/player-writes/evidence');
mkdirSync(evidence, { recursive: true });
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
const cleanupMessages: string[] = [];
const outstandingBatches: Promise<unknown>[] = [];
const retainedAuditUuids: string[] = [];
let auditBaseline: string[] = [];
const completedAuditKeys: string[] = [];
async function drainAudit() {
  if (!gmBrowser || !completedAuditKeys.length) return;
  const rows = await waitForLiveAudit(async () => {
    const facts = await gmBrowser!.page.evaluate(readNativeAuditRows, auditBaseline);
    const found = facts.map((row: any) => ({
      ...row,
      key: liveAuditKey(row.userId, row.agentId, row.tool, JSON.parse(row.args)),
    }));
    for (const row of found)
      if (completedAuditKeys.includes(row.key) && !retainedAuditUuids.includes(row.uuid))
        retainedAuditUuids.push(row.uuid);
    return found;
  }, completedAuditKeys);
  console.log(
    `[task21] AUDIT-DRAIN ${version}: ${JSON.stringify(rows.filter((row) => completedAuditKeys.includes(row.key)).map((row) => ({ entryId: row.entryId, uuid: row.uuid })))}`,
  );
}

let createdJournal = false;
let gmBrowser: (typeof browsers)[number] | undefined;
let completed = false;
let cleaned = false;
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
  const client = new Client({ name: 'task21-native-acceptance', version: '0.0.0-test' });
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
  const approvedCall = async (name: string, args: Record<string, unknown>) => {
    const agentId = registry.get(config.world, userId)?.agentId;
    if (!agentId) throw Error('The exact paired agent is unavailable');
    let result = await call(name, args);
    if (result.structured?.status === 'pending_approval') {
      const id = result.structured.id;
      console.log(
        `[task21] PENDING ${version} ${name}: status=pending_approval idPresent=${typeof id === 'string'} at=${new Date().toISOString()}`,
      );
      for (let i = 0; i < 600; i++) {
        const status = await call('approval_status', { id });
        if (status.isError || ['denied', 'expired'].includes(status.structured?.status))
          throw Error(`${name} approval failed: ${status.text}`);
        if (status.structured?.result !== undefined) {
          console.log(
            `[task21] POLL ${version} ${name}: completed resultPresent=true at=${new Date().toISOString()}`,
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
    if (result.isError) throw Error(`${name}: ${result.text}`);
    completedAuditKeys.push(liveAuditKey(userId, agentId, name, args));
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
      console.log(`[task21] NATIVE ${version} ${text}`);
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
function uuid(result: any, kind: string): string {
  const value =
    result.structured?.[kind === 'ChatMessage' ? 'messageUuid' : 'pageUuid'] ??
    result.text.match(
      kind === 'ChatMessage'
        ? /ChatMessage\.[A-Za-z0-9]+/
        : /JournalEntry\.[A-Za-z0-9]+\.JournalEntryPage\.[A-Za-z0-9]+/,
    )?.[0];
  if (typeof value !== 'string') throw Error(`Missing ${kind} UUID in completed approval result`);
  return value;
}
try {
  gmBrowser = await open(config.gmUser);
  const targets = await gmBrowser.page.evaluate(
    ({ id, playerName }) => {
      const game = (globalThis as any).game;
      const player = game.users.find((u: any) => u.name.toLowerCase() === playerName.toLowerCase());
      if (
        !game.user.isGM ||
        game.users.activeGM?.id !== game.user.id ||
        !player ||
        game.world.id !== 'test-world' ||
        game.journal.has(id)
      )
        throw Error('Prepared fixture identity is unavailable or already exists');
      return {
        gm: { id: game.user.id, name: game.user.name },
        player: { id: player.id, name: player.name },
        version: game.version,
        moduleVersion: game.modules.get('agent-gateway')?.version,
        auditTypeDeclared: game.documentTypes.JournalEntryPage.includes('agent-gateway.audit'),
      };
    },
    { id: journalId, playerName: config.playerUser },
  );
  if (!String(targets.version).startsWith(version.slice(1) + '.'))
    throw Error('Foundry generation differs from approved target');
  console.log(
    `[task21] VERSIONS ${version}: Foundry=${targets.version} module=${targets.moduleVersion}`,
  );
  if (!targets.auditTypeDeclared)
    throw Error(
      'Installed module manifest needs the reviewed audit document type and world reload',
    );
  auditBaseline = await gmBrowser.page.evaluate(() => {
    const game = (globalThis as any).game;
    return (
      game.journal
        .get(game.settings.get('agent-gateway', 'auditJournalId'))
        ?.pages.contents.map((p: any) => p.uuid) ?? []
    );
  });
  // This one fixture parent creation is separately included in the GM's exact approval plan.
  await gmBrowser.page.evaluate(
    ({ id, playerId }) =>
      (globalThis as any).JournalEntry.create(
        {
          _id: id,
          name: 'ag-test-task21-player-writes',
          ownership: { default: 0, [playerId]: 3 },
          flags: { 'agent-gateway': { fixture: true, task: 21 } },
        },
        { keepId: true, renderSheet: false },
      ).then((j: any) => {
        if (j.id !== id) throw Error('Fixture journal ID mismatch');
      }),
    { id: journalId, playerId: targets.player.id },
  );
  createdJournal = true;
  console.log(`[task21] ${version} fixture ${journalUuid} created; production bundle ${sha}`);
  for (const who of roles) {
    const user = targets[who];
    const browser = who === 'gm' ? gmBrowser : await open(user.name);
    const mcp = await session(user.name, user.id);
    for (let i = 0; i < 30; i++) {
      const info = await mcp.call('world_info');
      if (!info.isError) break;
      if (i === 29) throw Error(info.text);
      await new Promise((done) => setTimeout(done, 1000));
    }
    const list = await mcp.client.listTools();
    for (const name of ['chat_post', 'roll_formula', 'journal_write'])
      if (!list.tools.some((t) => t.name === name))
        throw Error(`${name} missing from real ${who} toolset`);
    const before = await browser.page.evaluate(() => ({
      messages: (globalThis as any).game.messages.contents.map((m: any) => m.uuid),
    }));
    const tag = `Task 21 ${version} ${who} ${fixtureRun}`;
    console.log(
      `[task21] READY ${version} ${user.name}: four real owner approvals will appear (chat, roll, page create, no-chat roll). The human approver must approve them in Foundry.`,
    );
    const auditBefore = await gmBrowser.page.evaluate(() => {
      const game = (globalThis as any).game;
      return (
        game.journal
          .get(game.settings.get('agent-gateway', 'auditJournalId'))
          ?.pages.contents.map((p: any) => p.id) ?? []
      );
    });
    const trackMessage = (result: any) => {
      cleanupMessages.push(uuid(result, 'ChatMessage'));
      return result;
    };
    const pending = [
      mcp
        .approvedCall('chat_post', { content: `${tag}: **AI-authored fixture message**` })
        .then(trackMessage),
      mcp
        .approvedCall('roll_formula', {
          formula: '1d6 + 2',
          flavor: `${tag}: validation roll`,
          toChat: true,
        })
        .then(trackMessage),
      mcp.approvedCall('journal_write', {
        journalUuid,
        title: `${tag} page`,
        markdown: `${tag}: **first line**.`,
      }),
      mcp.approvedCall('roll_formula', {
        formula: '1d6 + 2',
        flavor: `${tag}: no-chat validation roll`,
        toChat: false,
      }),
    ];
    const batch = startLiveBatch(pending);
    outstandingBatches.push(batch.settled);
    const app = browser.page.locator('#agent-gateway-approval');
    await app.locator('article').first().waitFor({ timeout: 15000 });
    await app.screenshot({ path: resolve(evidence, `${version}-${who}-approval.png`) });
    // Finalize witnessed creation before a fast append can legitimately invalidate its version.
    const results = await batch.result(drainAudit);
    const messages = [uuid(results[0], 'ChatMessage'), uuid(results[1], 'ChatMessage')];
    const pageUuid = uuid(results[2], 'JournalEntryPage');
    await gmBrowser.page.evaluate(
      ({ messages, pageUuid, baseline }) => {
        const game = (globalThis as any).game;
        const journal = game.journal.get(game.settings.get('agent-gateway', 'auditJournalId'));
        const targets = (journal?.pages.contents ?? [])
          .filter((p: any) => !baseline.includes(p.uuid))
          .flatMap((p: any) => p.system.targets)
          .filter((t: any) => [...messages, pageUuid].includes(t.uuid) && t.existed === false);
        if (targets.length !== 3 || targets.some((t: any) => !t.undoable))
          throw Error('Initial native creation witnesses are not safe before append');
      },
      { messages, pageUuid, baseline: auditBaseline },
    );
    console.log(
      `[task21] READY ${version} ${user.name}: approve the journal append in the same native owner dialog.`,
    );
    const append = mcp.approvedCall('journal_write', {
      journalUuid,
      pageUuid,
      title: `${tag} page`,
      markdown: `${tag}: second line.`,
    });
    const appendBatch = startLiveBatch([append]);
    outstandingBatches.push(appendBatch.settled);
    await app.locator('article').first().waitFor({ timeout: 15000 });
    await app.screenshot({ path: resolve(evidence, `${version}-${who}-append-approval.png`) });
    await appendBatch.result();
    const facts = await browser.page.evaluate(
      async ({ messages, pageUuid, journalUuid, before, tag }) => {
        const g = globalThis as any;
        const game = g.game;
        const docs = await Promise.all(messages.map((id) => g.fromUuid(id)));
        const p = await g.fromUuid(pageUuid);
        if (
          docs.some((m: any) => m.flags?.['agent-gateway']?.ai !== true) ||
          p.parent.uuid !== journalUuid ||
          !p.text.content.includes('first line') ||
          !p.text.content.includes('second line')
        )
          throw Error('Native message/page proof failed');
        const added = game.messages.contents.filter((m: any) => !before.messages.includes(m.uuid));
        if (added.length !== 2 || added.some((m: any) => !messages.includes(m.uuid)))
          throw Error('Unexpected chat mutation or toChat:false produced a message');
        const rendered = [];
        for (const doc of docs) {
          const html = await doc.renderHTML();
          const root = html?.nodeType === 1 ? html : html?.[0];
          if (!root?.querySelector('.agent-gateway-ai-marker'))
            throw Error('Native chat render hook did not mark the message');
          rendered.push(root.outerHTML);
        }
        return { messages, pageUuid, tag, rendered, version: game.version };
      },
      { messages, pageUuid, journalUuid, before, tag },
    );
    // Place real native render results side by side for reviewable screenshot evidence.
    await browser.page.evaluate(({ rendered, tag }) => {
      const old = document.getElementById('ag-task21-native-evidence');
      old?.remove();
      const section = document.createElement('section');
      section.id = 'ag-task21-native-evidence';
      section.style.cssText =
        'position:fixed;top:30px;left:30px;width:800px;z-index:2147483646;background:#eee;color:#111;padding:20px';
      const heading = document.createElement('h2');
      heading.textContent = tag;
      section.append(heading);
      for (const html of rendered) {
        const body = document.createElement('article');
        body.innerHTML = html;
        section.append(body);
      }
      document.body.append(section);
    }, facts);
    await browser.page
      .locator('#ag-task21-native-evidence')
      .screenshot({ path: resolve(evidence, `${version}-${who}-native-ai-markers.png`) });
    await drainAudit();
    const audit = await gmBrowser.page.evaluate(
      ({ before, userId, messages, pageUuid }) => {
        const game = (globalThis as any).game;
        const journal = game.journal.get(game.settings.get('agent-gateway', 'auditJournalId'));
        const pages = (journal?.pages.contents ?? []).filter(
          (p: any) => !before.includes(p.id) && p.system.userId === userId,
        );
        const entries = pages.map((p: any) => p.system);
        if (
          entries.length !== 5 ||
          new Set(entries.map((r: any) => r.entryId)).size !== 5 ||
          entries.some((r: any) => typeof r.entryId !== 'string' || !r.entryId || r.status !== 'ok')
        )
          throw Error('Native audited calls were not all retained');
        const creates = entries.filter((r: any) =>
          r.targets.some(
            (t: any) => [...messages, pageUuid].includes(t.uuid) && t.existed === false,
          ),
        );
        if (
          creates.length !== 3 ||
          creates.some((r: any) => r.targets.some((t: any) => !t.undoable))
        )
          throw Error('Native created UUID undo targets were not captured');
        const append = entries.find(
          (r: any) =>
            r.tool === 'journal_write' &&
            r.targets.some((t: any) => t.uuid === pageUuid && t.existed === true),
        );
        if (
          !append?.targets[0]?.before?.includes('first line') ||
          append.targets[0].before.includes('second line') ||
          !append.targets[0].undoable
        )
          throw Error('Native append before snapshot is missing');
        const noChat = entries.find(
          (r: any) => r.tool === 'roll_formula' && r.args.includes('"toChat":false'),
        );
        if (!noChat || noChat.targets.length) throw Error('No-chat roll audit target is incorrect');
        return {
          auditUuids: pages.map((p: any) => p.uuid),
          entries: entries.length,
          createdTargets: creates.length,
          appendSnapshot: true,
          noChatTargets: 0,
        };
      },
      { before: auditBefore, userId: user.id, messages, pageUuid },
    );
    for (const auditUuid of audit.auditUuids)
      if (!retainedAuditUuids.includes(auditUuid)) retainedAuditUuids.push(auditUuid);
    if ((await mcp.call('world_info')).isError) throw Error('Core call failed after native writes');
    console.log(`[task21] AUDIT ${version} ${user.name}: ${JSON.stringify(audit)}`);
    console.log(
      `[task21] PASS ${version} ${user.name}: native chat+roll AI markers, create+append and no-chat roll; ${messages.join(', ')}; ${pageUuid}`,
    );
  }
  completed = true;
} finally {
  // Cleanup was included in the same explicit approval. Preserve audit records and other fixtures.
  if (gmBrowser) {
    try {
      // Keep the GM witness alive while completed calls persist, even after UI/assertion failure.
      try {
        await drainAudit();
      } catch (error) {
        console.error(`[task21] AUDIT-DRAIN FAILED ${version}: ${String(error)}`);
      }
      if (!completed) {
        // A polling timeout must not leave an approvable continuation alive during cleanup.
        // Reload destroys pending local waiters; all started calls settle before deletion below.
        for (const browser of browsers) {
          await browser.page.reload();
          await browser.page.waitForFunction('globalThis.game?.ready === true');
        }
      }
      await Promise.all(outstandingBatches);
      try {
        await drainAudit();
      } catch (error) {
        console.error(`[task21] AUDIT-DRAIN FAILED ${version}: ${String(error)}`);
      }
      await gmBrowser.page.evaluate(
        async ({ messages, journalUuid, createdJournal }) => {
          const g = globalThis as any;
          for (const uuid of messages) {
            const doc = await g.fromUuid(uuid);
            if (doc) {
              if (doc.documentName !== 'ChatMessage' || doc.flags?.['agent-gateway']?.ai !== true)
                throw Error('Cleanup chat identity mismatch');
              await doc.delete();
            }
          }
          if (createdJournal) {
            const journal = await g.fromUuid(journalUuid);
            if (journal) {
              if (
                journal.flags?.['agent-gateway']?.task !== 21 ||
                journal.name !== 'ag-test-task21-player-writes'
              )
                throw Error('Cleanup journal identity mismatch');
              await journal.delete();
            }
          }
        },
        { messages: cleanupMessages, journalUuid, createdJournal },
      );
      const readback = await gmBrowser.page.evaluate(
        async ({ absent, retained }) => {
          const g = globalThis as any;
          for (const uuid of absent)
            if (await g.fromUuid(uuid)) throw Error('Created fixture remains after cleanup');
          for (const uuid of retained)
            if (!(await g.fromUuid(uuid))) throw Error('Audit entry missing after cleanup');
          return {
            absent: absent.length,
            retainedAuditEntries: retained.length,
            foundryVersion: g.game.version,
            moduleVersion: g.game.modules.get('agent-gateway')?.version,
          };
        },
        {
          absent: [...cleanupMessages, ...(createdJournal ? [journalUuid] : [])],
          retained: retainedAuditUuids,
        },
      );
      console.log(`[task21] READBACK ${version}: ${JSON.stringify(readback)}`);
      cleaned = true;
      console.log(
        `[task21] CLEAN ${version}: exact created journal and ${cleanupMessages.length} chat messages deleted; audit entries retained`,
      );
    } catch (error) {
      console.error(
        `[task21] CLEANUP REQUIRED ${version}: ${journalUuid}; ${cleanupMessages.join(', ')}; ${String(error)}`,
      );
    }
  }
  for (const browser of browsers.reverse()) await browser.close();
  for (const { client, server } of sessions) {
    await client.close();
    await server.close();
  }
  await link.close();
  store.close();
}
if (!completed || !cleaned)
  throw Error('Native task 21 acceptance or approved cleanup is incomplete');
console.log(`[task21] COMPLETE ${version} real default policy and native markers; sha256=${sha}`);
