import { documentUpdate } from '@agent-gateway/protocol';
import { defineWriteHandler, invalid } from './_write.js';
import {
  checkData,
  checkDocument,
  checkFolder,
  parseData,
  preview,
  resolveDocument,
  resolveFolder,
  successful,
} from './_documents.js';

export const documentUpdateHandler = defineWriteHandler({
  targets: () => [],
  async run(ctx) {
    const args = documentUpdate.input.parse(ctx.args);
    const changes = parseData(args.update);
    const doc = await resolveDocument(ctx, args.uuid);
    checkData(changes, doc.documentName, true);
    let folder;
    if (Object.hasOwn(changes, 'folder')) {
      if (
        doc.parent ||
        (changes.folder !== null &&
          (typeof changes.folder !== 'string' || changes.folder.length === 0))
      )
        invalid('Root folder must be an existing folder ID or null');
      folder = await resolveFolder(ctx, changes.folder ?? undefined, doc.documentName);
    }
    // Dotted/deletion folder forms must not evade destination validation.
    if (
      Object.keys(changes).some(
        (k) => k !== 'folder' && k.replace(/^-=/, '').split('.')[0] === 'folder',
      )
    )
      invalid('Use the native folder field');
    preview(doc, changes);
    await ctx.snapshot(doc.uuid);
    checkDocument(ctx, doc);
    if (folder) checkFolder(ctx, folder, doc.documentName);
    preview(doc, changes);
    successful(doc, await doc.update(changes, ctx.callOptions));
    return { text: `Document updated: ${doc.uuid}`, structured: { uuid: doc.uuid } };
  },
});
