import { documentCreate } from '@agent-gateway/protocol';
import { defineWriteHandler, invalid } from './_write.js';
import { createDocument, parseData, resolveDocument, resolveFolder } from './_documents.js';

export const documentCreateHandler = defineWriteHandler({
  targets: () => [],
  async run(ctx) {
    const args = documentCreate.input.parse(ctx.args);
    if (args.folder && args.parentUuid) invalid('Folder and parent are mutually exclusive');
    const data = parseData(args.data);
    const parent = args.parentUuid ? await resolveDocument(ctx, args.parentUuid) : undefined;
    const folder = await resolveFolder(ctx, args.folder, args.type);
    const uuid = await createDocument(ctx, args.type, data, parent, folder);
    return { text: `Document created: ${uuid}`, structured: { uuid } };
  },
});
