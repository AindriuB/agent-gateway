import { scriptRun } from '@agent-gateway/protocol';
import type { OpHandler } from '../ops/types.js';
import { approvedCode, codeGM, codeError, codeResult } from './_code.js';
declare const game: unknown;
declare const canvas: unknown;
declare const ui: unknown;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;
export const scriptRunHandler: OpHandler = async (ctx) => {
  try {
    approvedCode(ctx);
    const { source } = scriptRun.input.parse(ctx.args);
    const value = await new AsyncFunction('game', 'canvas', 'ui', source)(game, canvas, ui);
    codeGM(ctx);
    const result = codeResult(value);
    return { text: result.result, structured: result };
  } catch (error) {
    return codeError(error);
  }
};
