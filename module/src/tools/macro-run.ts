/* eslint-disable @typescript-eslint/no-explicit-any */
import { macroRun } from '@agent-gateway/protocol';
import { fromUuidCompat } from '../compat/index.js';
import { OpAdmissionError, type OpHandler } from '../ops/types.js';
import { approvedCode, codeGM, codeError, codeResult, parseCodeArgs } from './_code.js';
declare const game: any;
declare const foundry: any;
interface Captured {
  macro: any;
  collection: any;
  pack: any;
  user: any;
  command: string;
  type: string;
  stamp: number;
  parsed: unknown;
  uuid: string;
}
const captured = new WeakMap<object, Captured>();
const refuse = (message: string): never => {
  throw new OpAdmissionError('FORBIDDEN', message);
};
function attest(ctx: any, record: Captured): void {
  const { macro, collection, pack, user, command, type, stamp, uuid } = record;
  if (
    codeGM(ctx) !== user ||
    macro.documentName !== 'Macro' ||
    macro.parent ||
    collection.get(macro.id) !== macro ||
    macro.uuid !== uuid ||
    macro.command !== command ||
    macro.type !== type ||
    macro._stats?.modifiedTime !== stamp ||
    !Number.isFinite(stamp) ||
    macro.canUserExecute?.(user) !== true ||
    macro.canExecute !== true
  )
    refuse('The reviewed Macro or native permission changed');
  if (
    pack
      ? game.packs?.get(macro.pack) !== pack ||
        pack.collection !== macro.pack ||
        pack.documentName !== 'Macro' ||
        pack.testUserPermission?.(user, 'LIMITED') !== true
      : macro.pack || game.macros !== collection
  )
    refuse('The canonical Macro collection changed');
}
export const macroRunHandler: OpHandler = async (ctx) => {
  try {
    approvedCode(ctx);
    const record = ctx.args && typeof ctx.args === 'object' ? captured.get(ctx.args) : undefined;
    if (!record)
      throw new OpAdmissionError('FORBIDDEN', 'The Macro has no trusted full-source admission');
    attest(ctx, record);
    const value = await record.macro.execute({ args: record.parsed });
    codeGM(ctx);
    const result = codeResult(value);
    return { text: result.result, structured: result };
  } catch (error) {
    return codeError(error);
  }
};
macroRunHandler.admit = async (ctx) => {
  const args = macroRun.input.parse(ctx.args);
  const user = codeGM(ctx);
  const parsed = parseCodeArgs(args.args);
  const location = foundry.utils.parseUuid(args.macroUuid);
  if (!location || location.type !== 'Macro' || location.embedded?.length)
    throw new OpAdmissionError(
      'INVALID_ARGS',
      'A canonical world or compendium Macro UUID is required',
    );
  const macro = await fromUuidCompat(args.macroUuid);
  codeGM(ctx);
  if (
    !macro ||
    typeof macro.command !== 'string' ||
    macro.command.length > 20000 ||
    !['script', 'chat'].includes(macro.type) ||
    typeof macro.execute !== 'function'
  )
    throw new OpAdmissionError(
      'INVALID_ARGS',
      'A supported Macro with at most 20000 source characters is required',
    );
  const pack = macro.pack ? game.packs?.get(macro.pack) : undefined;
  const collection = pack ?? game.macros;
  if (!collection || location.collection !== collection || location.uuid !== macro.uuid)
    refuse('The resolved Macro is not canonical');
  const record: Captured = {
    macro,
    collection,
    pack,
    user,
    command: macro.command,
    type: macro.type,
    stamp: macro._stats?.modifiedTime,
    parsed,
    uuid: macro.uuid,
  };
  attest(ctx, record);
  const review = Object.freeze({ ...args, source: record.command });
  captured.set(review, record);
  return review;
};
