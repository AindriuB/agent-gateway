/* eslint-disable @typescript-eslint/no-explicit-any */
/** Read-only reconciliation of the exact failed native run before its already-approved human Undo. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNativeBundleHash } from './native-plan.js';
import { attachNativeBaseline } from './native-resume.js';
import { createHash } from 'node:crypto';
import { loadContext } from '../../../../e2e/lib/context.js';
import { openUserBrowser, joinWorld, asJoinPage } from '../../../../e2e/lib/browser.js';
const directory = process.env.AGENT_GATEWAY_TASK23_RECONCILE;
if (!directory || !/^\/private\/tmp\/task23-native-v14-[a-f0-9]{12}$/.test(directory))
  throw Error('Choose the exact reviewed failed-run directory');
const fixtureRun = directory.slice(-12);
const cards = ['roots', 'children', 'updates', 'group-delete'].flatMap((label) =>
  JSON.parse(readFileSync(resolve(directory, `${label}-rendered-requests.json`), 'utf8')),
);
const { config, paths } = loadContext();
if (config.world !== 'test-world') throw Error('Only configured test-world');
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const bundle = readFileSync(resolve(root, 'dist/module/main.js'));
assertNativeBundleHash(
  createHash('sha256').update(bundle).digest('hex'),
  process.env.AGENT_GATEWAY_TASK23_EXPECTED_BUNDLE_SHA,
);
const browser = await openUserBrowser(config, paths, config.gmUser, { headed: false });
try {
  await browser.context.route('**/modules/agent-gateway/dist/module/main.js*', (route) =>
    route.fulfill({ body: bundle, contentType: 'text/javascript' }),
  );
  await joinWorld(asJoinPage(browser.page), config, config.gmUser);
  if (
    !(await browser.page.evaluate(() => String((globalThis as any).game.version).startsWith('14.')))
  )
    throw Error('Typed zero-MCP reconciliation requires actual native v14');
  if (process.env.AGENT_GATEWAY_TASK23_POSTUNDO === '1') {
    const before = JSON.parse(readFileSync(resolve(directory, 'resume-checkpoint.json'), 'utf8'));
    const resume = JSON.parse(
      readFileSync(resolve(directory, 'checkpoint-before-calls.json'), 'utf8'),
    );
    const facts = await browser.page.evaluate(
      async ({ before, source }) => {
        const g = globalThis as any;
        const audit = await g.fromUuid(before.deleteAudit.uuid);
        if (
          !audit ||
          audit.system.userId !== before.userId ||
          audit.system.agentId !== before.agentId
        )
          throw Error('Exact audit identity changed');
        const states: any[] = [];
        for (const uuid of before.created)
          states.push({ uuid, exists: Boolean(await g.fromUuid(uuid)) });
        const journal = g.game.journal.get(g.game.settings.get('agent-gateway', 'auditJournalId'));
        const reservations = journal.pages.contents
          .filter((p: any) => p.flags?.['agent-gateway']?.undoReservation?.entry === audit.uuid)
          .map((p: any) => p.uuid);
        const audits = [];
        for (const row of before.audits) {
          const fresh = await g.fromUuid(row.uuid);
          if (!fresh) throw Error('Retained audit missing');
          audits.push({ uuid: fresh.uuid, system: fresh.system.toObject() });
        }
        const cls = g.CONFIG.JournalEntryPage.documentClass;
        const rows = await cls.database.get(cls, { parent: journal, query: { _id: audit.id } });
        const server = rows.find((row: any) => row.id === audit.id);
        const rawResponse = await g.SocketInterface.dispatch('modifyDocument', {
          type: 'JournalEntryPage',
          action: 'get',
          operation: { parentUuid: journal.uuid, query: { _id: audit.id } },
        });
        const raw = rawResponse.result.find((row: any) => row._id === audit.id);
        if (!raw) throw Error('Exact raw audit missing');
        const durableUndo = {
          rawSystem: raw.system,

          serverObject: server?.toObject()?.system,
          serverSource: server?._source?.system,
          serverDirect: {
            undoCompleted: server?.system?.undoCompleted,
            undoneAt: server?.system?.undoneAt,
            undoneBy: server?.system?.undoneBy,
          },
          clientSource: audit._source.system,
          clientDirect: {
            undoCompleted: audit.system.undoCompleted,
            undoneAt: audit.system.undoneAt,
            undoneBy: audit.system.undoneBy,
          },
          registeredModel: Boolean(g.CONFIG.JournalEntryPage.dataModels['agent-gateway.audit']),
          nativeTypes: cls.TYPES.includes('agent-gateway.audit'),
          moduleDocumentTypes: g.game.modules.get('agent-gateway').documentTypes,
        };
        const currentSource = (await g.fromUuid(source.uuid)).toObject();
        const actorBefore =
          before.snapshots[before.roots.findIndex((uuid: string) => uuid.startsWith('Actor.'))];
        const candidate = g.CONFIG.Actor.documentClass.fromSource(structuredClone(actorBefore), {
          strict: true,
          creation: true,
        });
        return {
          durableUndo,
          foundryVersion: g.game.version,
          states,
          rootsAbsent: before.roots.every((uuid: string) =>
            states.some((s: any) => s.uuid === uuid && !s.exists),
          ),
          audit: { uuid: audit.uuid, system: audit.system.toObject() },
          retained: audits.length,
          audits,
          reservations,
          resumeSourceUnchanged: JSON.stringify(currentSource) === JSON.stringify(source.source),
          originalSourceUnavailable: before.originalSourceUnavailable,
          actorSnapshotEffectIds: actorBefore.effects.map((e: any) => e._id),
          unsavedActorEffectIds: candidate.effects.contents.map((e: any) => e.id),
          actorNativeCreateUsesMigration: /migrateActorSource/.test(
            g.CONFIG.Actor.documentClass.createDocuments.toString(),
          ),
          worldTime: g.game.time.worldTime,
        };
      },
      { before, source: resume.source },
    );
    writeFileSync(
      resolve(directory, 'post-undo-reconciliation.json'),
      JSON.stringify(facts, null, 2),
    );
    console.log(
      JSON.stringify({
        foundryVersion: facts.foundryVersion,
        absent: facts.states.filter((s: any) => !s.exists).length,
        rootsAbsent: facts.rootsAbsent,
        retained: facts.retained,
        undoCompleted: facts.audit.system.undoCompleted.length,
        undoneAtPresent: Boolean(facts.audit.system.undoneAt),
        reservations: facts.reservations.length,
        resumeSourceUnchanged: facts.resumeSourceUnchanged,
        originalSourceUnavailable: facts.originalSourceUnavailable,
        actorSnapshotEffects: facts.actorSnapshotEffectIds.length,
        unsavedActorEffects: facts.unsavedActorEffectIds.length,
        actorNativeCreateUsesMigration: facts.actorNativeCreateUsesMigration,
      }),
    );
  } else {
    const freshCheckpoint = await browser.page.evaluate(
      async ({ cards, fixtureRun }) => {
        const g = globalThis as any;
        if (
          !g.game.user.isGM ||
          g.game.users.activeGM?.id !== g.game.user.id ||
          g.game.users.filter((u: any) => u.active && u.isGM).length !== 1
        )
          throw Error('GM isolation failed');
        const journal = g.game.journal.get(g.game.settings.get('agent-gateway', 'auditJournalId'));
        const pages = journal.pages.contents.filter(
          (p: any) => p.type === 'agent-gateway.audit' && p.system.userId === g.game.user.id,
        );
        const first = pages.filter(
          (p: any) =>
            p.system.tool === 'document_create' &&
            JSON.parse(p.system.args).type === 'Actor' &&
            JSON.parse(p.system.args).data === cards[0].args.data,
        );
        if (first.length !== 1) throw Error('Exact nonce Actor audit is not unique');
        const agentId = first[0].system.agentId;
        const deleted = pages.filter(
          (p: any) =>
            p.system.agentId === agentId &&
            p.system.tool === 'document_delete' &&
            JSON.stringify(JSON.parse(p.system.args)) === JSON.stringify(cards[7].args),
        );
        if (deleted.length !== 1) throw Error('Exact grouped delete audit is not unique');
        const last = deleted[0];
        const audits = cards.map((card: any) => {
          const matches = pages.filter(
            (p: any) =>
              p.system.agentId === agentId &&
              p.system.timestamp >= first[0].system.timestamp - 10000 &&
              p.system.timestamp <= last.system.timestamp &&
              p.system.tool === card.tool &&
              JSON.stringify(Object.entries(JSON.parse(p.system.args)).sort()) ===
                JSON.stringify(Object.entries(card.args).sort()),
          );
          if (
            matches.length !== 1 ||
            matches[0].system.status !== 'ok' ||
            matches[0].system.relayed
          )
            throw Error('Exact successful local audit not unique');
          return { uuid: matches[0].uuid, system: matches[0].system.toObject() };
        });
        if (new Set(audits.map((p: any) => p.uuid)).size !== 8)
          throw Error('Expected eight distinct audits');
        const roots = cards[7].args.uuids;
        const created = audits
          .slice(0, 5)
          .flatMap((row: any) =>
            row.system.targets.filter((t: any) => t.existed === false).map((t: any) => t.uuid),
          );
        if (created.length !== 5 || new Set(created).size !== 5)
          throw Error('Expected five exact created targets');
        for (const uuid of created)
          if (await g.fromUuid(uuid)) throw Error('Failed-run fixture unexpectedly remains');
        const snapshots = roots.map((uuid: string) => {
          const target = last.system.targets.find((t: any) => t.uuid === uuid);
          if (!target?.undoable || !target.existed || target.existsAfter || !target.before)
            throw Error('Trusted full root snapshot unavailable');
          const data = JSON.parse(target.before);
          if (data._id !== uuid.split('.').at(-1)) throw Error('Root snapshot identity mismatch');
          return data;
        });
        if (
          last.system.undoneAt ||
          last.system.undoCompleted.length ||
          journal.pages.contents.some(
            (p: any) => p.flags?.['agent-gateway']?.undoReservation?.entry === last.uuid,
          )
        )
          throw Error('Delete entry already undone or reserved');
        const records =
          JSON.parse(
            localStorage.getItem(`agent-gateway.${g.game.world.id}.approvalQueue`) ?? '{}',
          )[g.game.user.id] ?? [];
        const approvals = cards.map((card: any) => {
          const record = records.find((r: any) => r.id === card.id);
          if (!record || record.status !== 'approved' || !record.result || record.resultFailed)
            throw Error('Exact approved result is not terminal successful');
          return {
            id: record.id,
            status: record.status,
            result: record.result,
            resultFailed: record.resultFailed,
          };
        });
        const source = (
          await g.fromUuid('Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z')
        ).toObject();
        return {
          version: 'v14',
          fixtureRun,
          userId: g.game.user.id,
          agentId,
          created,
          roots,
          snapshots,
          audits,
          approvals,
          deleteAudit: { uuid: last.uuid, id: last.id },
          sourceAtResume: source,
          originalSourceUnavailable: true,
          foundryVersion: g.game.version,
        };
      },
      { cards, fixtureRun },
    );
    writeFileSync(
      resolve(directory, 'reconciliation-fresh-diagnostic.json'),
      JSON.stringify(freshCheckpoint, null, 2),
    );
    const checkpoint = attachNativeBaseline(
      freshCheckpoint,
      JSON.parse(readFileSync(resolve(directory, 'checkpoint-before-calls.json'), 'utf8')),
      JSON.parse(readFileSync(resolve(directory, 'checkpoint-before-undo.json'), 'utf8')),
      createHash('sha256').update(bundle).digest('hex'),
    );
    const templatePath = 'modules/agent-gateway/templates/audit/audit.hbs';
    const templateSource = readFileSync(resolve(root, 'templates/audit/audit.hbs'), 'utf8');
    const templateProof = await browser.page.evaluate(
      async ({ path, source, auditId }) => {
        const g = globalThis as any;
        g.Handlebars.registerPartial(path, g.Handlebars.compile(source, { preventIndent: true }));
        const compiled = await g.foundry.applications.handlebars.getTemplate(path);
        if (compiled !== g.Handlebars.partials[path])
          throw Error('Native getTemplate did not return cached compiled HBS');
        const Menu = g.game.settings.menus.get('agent-gateway.audit').type;
        const app = new Menu();
        await app.render({ force: true });
        const control = document.querySelector(
          `#agent-gateway-audit button[data-action="undo"][data-page-id="${auditId}"]`,
        );
        if (!control) throw Error('Native Audit App did not render exact Undo control');
        await app.close();
        return {
          nativeCacheHit: true,
          actualAuditAppRendered: true,
          exactUndoControlPresent: true,
        };
      },
      { path: templatePath, source: templateSource, auditId: checkpoint.deleteAudit.id },
    );
    writeFileSync(
      resolve(directory, 'template-cache-proof.json'),
      JSON.stringify(
        {
          ...templateProof,
          path: templatePath,
          sourceSha: createHash('sha256').update(templateSource).digest('hex'),
        },
        null,
        2,
      ),
    );
    writeFileSync(
      resolve(directory, 'resume-checkpoint.json'),
      JSON.stringify(checkpoint, null, 2),
    );
    console.log(
      JSON.stringify({
        foundryVersion: freshCheckpoint.foundryVersion,
        successfulAudits: checkpoint.audits.length,
        terminalApprovals: freshCheckpoint.approvals.length,
        absent: checkpoint.created.length,
        roots: checkpoint.roots.length,
        snapshotChildren: checkpoint.created.length - checkpoint.roots.length,
        reservationClear: true,
        originalSourceUnavailable: checkpoint.originalSourceUnavailable,
      }),
    );
  }
} finally {
  await browser.context.close();
}
