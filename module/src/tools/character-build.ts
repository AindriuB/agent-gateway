/* eslint-disable @typescript-eslint/no-explicit-any */
import { characterBuild, characterBuildOutput } from '@agent-gateway/protocol';
import type { DispatchResult, OpContext, OpHandler } from '../ops/types.js';
import { defineWriteHandler, forbid, invalid, WriteError } from './_write.js';
import { invokeAdapter } from './_adapters.js';
import { selectBuildHook } from '../adapters/build.js';
import { canObservePack } from './compendium-search.js';
declare const game: any;
declare const fromUuid: (uuid: string) => Promise<any>;
const hook = () => selectBuildHook(String(game.system?.id));
const write = defineWriteHandler({
  targets: () => [],
  run(ctx) {
    const args = characterBuild.input.parse(ctx.args);
    return invokeAdapter(
      ctx,
      args.actorUuid!,
      characterBuildOutput,
      (_adapter, actor, execution) => hook().apply(actor, args.changes ?? [], execution!),
      true,
    );
  },
});

/** GM only: list the choices a compendium Item and its grants will ask for. No Actor, no writes. */
async function listChoices(ctx: OpContext, uuid: string): Promise<DispatchResult> {
  try {
    if (ctx.user.isGM !== true) forbid('Listing choices is limited to the GM');
    const systemId = String(game.system?.id);
    const build = hook();
    if (!build.listChoices)
      return {
        text: 'Listing choices is not supported on this system.',
        structured: { systemId, supported: false, boosts: [], skills: [], featSlots: [] },
      };
    const parts = uuid.split('.');
    if (parts.length !== 5 || parts[0] !== 'Compendium' || parts[3] !== 'Item')
      invalid('A canonical compendium Item UUID is required');
    const pack = game.packs?.get(`${parts[1]}.${parts[2]}`);
    if (!pack || pack.documentName !== 'Item' || !canObservePack(pack, ctx.user.id))
      invalid('Compendium entry not found.');
    const doc = await fromUuid(uuid);
    if (!doc || doc.documentName !== 'Item' || doc.uuid !== uuid || doc.pack !== pack.collection)
      invalid('Compendium entry not found.');
    const source = typeof doc.toObject === 'function' ? doc.toObject() : doc._source;
    const { choices, message } = await build.listChoices(source, uuid);
    const structured = characterBuildOutput.parse({
      systemId,
      supported: true,
      boosts: [],
      skills: [],
      featSlots: [],
      choices,
      ...(message ? { message } : {}),
    });
    return { text: JSON.stringify(structured), structured };
  } catch (error) {
    if (error instanceof WriteError) return { error: { code: error.code, message: error.message } };
    throw error;
  }
}

export const characterBuildHandler: OpHandler = (ctx) => {
  const args = characterBuild.input.parse(ctx.args);
  if (args.listChoices !== undefined) return listChoices(ctx, args.listChoices);
  return args.changes !== undefined
    ? write(ctx)
    : invokeAdapter(ctx, args.actorUuid!, characterBuildOutput, (_adapter, actor) =>
        hook().describe(actor),
      );
};
characterBuildHandler.prepare = (ctx) => {
  if ((ctx.args as { changes?: unknown }).changes !== undefined) ctx.escalate!('write');
};
