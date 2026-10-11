import { documentDelete } from '@agent-gateway/protocol';
import { defineWriteHandler, invalid } from './_write.js';
import { checkDocument, resolveDocument } from './_documents.js';

declare const fromUuid: (uuid: string) => Promise<unknown>;
export const documentDeleteHandler = defineWriteHandler({
  targets: () => [],
  async run(ctx) {
    const args = documentDelete.input.parse(ctx.args);
    const uuids = [...new Set(args.uuids)];
    if (uuids.some((a) => uuids.some((b) => a !== b && b.startsWith(`${a}.`))))
      invalid('Ancestor and descendant deletes cannot be combined');
    const docs = [];
    for (const uuid of uuids) docs.push(await resolveDocument(ctx, uuid, 'delete'));
    for (const doc of docs) await ctx.snapshot(doc.uuid);
    // Validate the complete set again after all awaited snapshots, before deleting anything.
    for (const doc of docs) checkDocument(ctx, doc, 'delete');
    for (const doc of docs) {
      checkDocument(ctx, doc, 'delete');
      const result = await doc.delete(ctx.callOptions);
      if (result !== doc || (await fromUuid(doc.uuid)))
        throw new Error('Native deletion was cancelled or did not remove its document');
    }
    return {
      text: `Deleted ${uuids.length} documents`,
      structured: { uuids, deleted: uuids.length },
    };
  },
});
