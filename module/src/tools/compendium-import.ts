/* eslint-disable @typescript-eslint/no-explicit-any */
import { compendiumImport } from '@agent-gateway/protocol';
import { isAuditDocument } from '../audit/guard.js';
import { AUDIT_LIMITS } from '../audit/types.js';
import type { DispatchResult } from '../ops/types.js';
import { defineWriteHandler, forbid, type WriteContext } from './_write.js';
import { embedHookFor } from '../adapters/embed.js';
import {
  ROOTS,
  bounded,
  canonical,
  checkDocument,
  createDocument,
  createEmbeddedBatch,
  gm,
  resolveFolder,
} from './_documents.js';

declare const game: any;
declare const fromUuid: (uuid: string) => Promise<any>;

async function embed(
  ctx: WriteContext,
  args: ReturnType<typeof compendiumImport.input.parse>,
  entry: any,
  check: (entry?: any) => void,
): Promise<DispatchResult> {
  if (entry.documentName !== 'Item') forbid('Only an Item entry can be embedded in an Actor');
  const actor = await fromUuid(args.actorUuid!);
  checkDocument(ctx, actor);
  if (
    actor.documentName !== 'Actor' ||
    actor.uuid !== args.actorUuid ||
    !canonical(actor) ||
    actor.parent
  )
    forbid('A canonical owned world Actor is required');
  const collection = game.collections?.get('Item');
  if (
    collection?.documentClass?.documentName !== 'Item' ||
    typeof collection.fromCompendium !== 'function'
  )
    forbid('Native world import conversion is unavailable');
  const converted = collection.fromCompendium(entry, { keepId: false });
  // Compendium sources keep pack-only root keys (a pf2e source has `folder: null` and `sort`);
  // an embedded Item has neither a folder nor a pack sort position.
  delete converted.folder;
  delete converted.sort;
  bounded(converted);
  const systemId = String(game.system?.id ?? 'generic');
  const hook = embedHookFor(systemId);
  const data = await hook.prepare({
    systemId,
    actor,
    entry,
    source: converted,
    overrides: args.overrides ?? {},
    user: gm(ctx),
    ...(args.choices ? { choices: args.choices } : {}),
    ...(args.onUnanswered ? { onUnanswered: args.onUnanswered } : {}),
  });
  bounded(data);
  // The audit call id rides in ctx.callOptions (agentGateway.callId); a hook that answers choices
  // keys its per-call decisions on it, and removes them when the create ends.
  const create = () =>
    createEmbeddedBatch(
      ctx,
      'Item',
      data,
      actor,
      () => {
        check(entry);
        checkDocument(ctx, actor);
      },
      hook.observe,
    );
  const ran = hook.run
    ? await hook.run(
        {
          actor,
          callId: ctx.callOptions.agentGateway!.callId,
          ...(args.choices ? { choices: args.choices } : {}),
        },
        create,
      )
    : { value: await create(), report: [], timedOut: false };
  const batch = ran.value;
  const report = ran.report.slice(0, 64);
  const incomplete = ran.timedOut === true || report.some((r) => r.status !== 'answered');
  const lines = [`Compendium entry embedded: ${batch.uuids[0]}`];
  if (batch.uuids.length > 1)
    lines.push(`Created ${batch.uuids.length} documents including grants.`);
  if (batch.uuids.length > AUDIT_LIMITS.targets)
    lines.push(
      `The audit is incomplete: only the first ${AUDIT_LIMITS.targets} created documents are listed.`,
    );
  if (batch.uncorrelated > 0)
    lines.push(
      `${batch.uncorrelated} native write(s) made by the system during creation are uncorrelated with this audit entry and are not undoable here (task 44 owns that). The count may include concurrent writes to the same Actor, and a possible unawaited Actor update after creation is not counted.`,
    );
  // A hook's own disclosure: fixed text, bounded here, and control characters are dropped.
  const note = hook.note?.(data);
  if (typeof note === 'string' && note)
    lines.push(note.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300));
  if (ran.timedOut)
    lines.push(
      'The create ran past the time limit for answering choices; any choice raised after that was ignored.',
    );
  if (report.length) {
    lines.push(
      `Choices: ${report.map((r) => `${r.flag} ${r.status}`).join(', ')}.`,
      ...(incomplete
        ? ['The build is incomplete: some choices were left unanswered, rejected or unsupported.']
        : []),
    );
  }
  if (args.choices?.length)
    lines.push(
      'pf2e follow-up item updates made while answering choices are not correlated with this audit entry (task 44).',
    );
  return {
    text: lines.join('\n'),
    structured: {
      uuid: batch.uuids[0]!,
      created: batch.uuids.slice(0, AUDIT_LIMITS.targets),
      ...(report.length || ran.timedOut ? { choiceReport: report, incomplete } : {}),
    },
  };
}
export const compendiumImportHandler = defineWriteHandler({
  targets: () => [],
  async run(ctx) {
    const args = compendiumImport.input.parse(ctx.args);
    const parts = args.uuid.split('.');
    if (parts.length !== 5 || parts[0] !== 'Compendium')
      forbid('A canonical compendium entry UUID is required');
    const pack = game.packs?.get(`${parts[1]}.${parts[2]}`);
    const type = parts[3]!;
    const check = (entry?: any) => {
      const user = gm(ctx);
      if (
        !pack ||
        game.packs?.get(pack.collection) !== pack ||
        pack.documentName !== type ||
        !ROOTS.includes(type as any) ||
        pack.testUserPermission?.(user, 'OBSERVER') !== true
      )
        forbid('A visible supported compendium is required');
      if (
        entry &&
        (entry.uuid !== args.uuid ||
          entry.pack !== pack.collection ||
          entry.parent ||
          entry.documentName !== type ||
          pack.get(entry.id) !== entry ||
          isAuditDocument(entry))
      )
        forbid('A canonical supported compendium entry is required');
    };
    check();
    const entry = await pack.getDocument(parts[4]);
    if (!entry) forbid('Compendium entry is unavailable');
    check(entry);
    if (args.actorUuid !== undefined) return embed(ctx, args, entry, check);
    const collection = game.collections?.get(type);
    if (
      collection?.documentClass?.documentName !== type ||
      typeof collection.fromCompendium !== 'function'
    )
      forbid('Native world import conversion is unavailable');
    // Native conversion operates on a fresh source copy and removes root ID/source folder.
    const data = collection.fromCompendium(entry, { clearFolder: true, keepId: false });
    bounded(data);
    if (Object.hasOwn(data, '_id') || Object.hasOwn(data, 'folder'))
      throw new Error('Native import conversion retained source identity');
    const folder = await resolveFolder(ctx, args.folder, type);
    check(entry);
    const uuid = await createDocument(ctx, type, data, undefined, folder, true, () => check(entry));
    return { text: `Compendium entry imported: ${uuid}`, structured: { uuid } };
  },
});
