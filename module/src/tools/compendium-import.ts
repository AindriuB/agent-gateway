/* eslint-disable @typescript-eslint/no-explicit-any */
import { compendiumImport } from '@agent-gateway/protocol';
import { isAuditDocument } from '../audit/guard.js';
import { defineWriteHandler, forbid } from './_write.js';
import { ROOTS, bounded, createDocument, gm, resolveFolder } from './_documents.js';

declare const game: any;
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
