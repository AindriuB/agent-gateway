/* eslint-disable @typescript-eslint/no-explicit-any */
import type { z } from 'zod';
import { fromUuidCompat } from '../compat/index.js';
import { readWorldSnapshot } from '../policy/snapshot.js';
import { folderAllowed } from '../policy/folders.js';
import { selectAdapter } from '../adapters/index.js';
import {
  AdapterUnsupportedError,
  type AdapterExecutionContext,
  type SystemAdapter,
} from '../adapters/types.js';
import { forbid, invalid, owns, trustedUser, WriteError, type WriteContext } from './_write.js';
import type { DispatchResult, OpContext } from '../ops/types.js';
declare const game: any;
declare const CONFIG: any;
/** Clone inert plain data iteratively before any recursive schema parser or serialization. */
export function boundedAdapterData(input: unknown): unknown {
  const seen = new Set<object>();
  const root: { value?: unknown } = {};
  const stack = [{ value: input, parent: root as any, key: 'value', depth: 0 }];
  let nodes = 0,
    size = 0;
  while (stack.length) {
    const { value, parent, key, depth } = stack.pop()!;
    if (++nodes > 4096 || depth > 12) throw Error('Adapter data exceeds structural bounds');
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
      if (typeof value === 'number' && !Number.isFinite(value))
        throw Error('Nonfinite adapter data');
      parent[key] = value;
      size += 16;
    } else if (typeof value === 'string') {
      size += value.length * 3;
      if (value.length > 8192) throw Error('Adapter string exceeds bounds');
      parent[key] = value;
    } else if (typeof value === 'object') {
      if (seen.has(value)) throw Error('Cyclic or shared adapter data');
      seen.add(value);
      if (
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      )
        throw Error('Adapter data must be plain');
      const desc = Object.getOwnPropertyDescriptors(value);
      const keys = Object.keys(desc).filter((k) => !(Array.isArray(value) && k === 'length'));
      if (keys.length > 512 || (Array.isArray(value) && value.length > 512))
        throw Error('Adapter collection exceeds bounds');
      const out: any = Array.isArray(value) ? [] : Object.create(null);
      parent[key] = out;
      for (const k of keys) {
        if (
          k.length > 256 ||
          ['__proto__', 'prototype', 'constructor'].includes(k) ||
          !('value' in desc[k]!)
        )
          throw Error('Unsafe adapter property');
        size += k.length * 3;
        stack.push({ value: desc[k]!.value, parent: out, key: k, depth: depth + 1 });
      }
    } else throw Error('Adapter data is not JSON');
    if (size > 65536) throw Error('Adapter result exceeds byte budget');
  }
  return root.value;
}
export function actionOptions(raw: string | undefined): Readonly<Record<string, unknown>> {
  if (raw === undefined) return Object.freeze({});
  try {
    if (raw.length > 8192) throw Error();
    const value = boundedAdapterData(JSON.parse(raw));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return Object.freeze(value as Record<string, unknown>);
  } catch {
    return invalid('Action options must be a bounded inert JSON object');
  }
}
function checkActor(ctx: OpContext, actor: any, uuid: string): any {
  const user = trustedUser(ctx);
  if (
    game.user !== user ||
    ctx.user.isGM !== (user.isGM === true) ||
    actor?.documentName !== 'Actor' ||
    typeof CONFIG.Actor?.documentClass !== 'function' ||
    !(actor instanceof CONFIG.Actor.documentClass) ||
    actor.parent ||
    actor.pack ||
    actor.isToken === true ||
    actor.token ||
    typeof actor.id !== 'string' ||
    actor.uuid !== uuid ||
    uuid !== `Actor.${actor.id}` ||
    game.actors?.get(actor.id) !== actor ||
    (!user.isGM && !owns(actor, user)) ||
    !folderAllowed(actor, user.isGM === true, readWorldSnapshot())
  )
    forbid('An accessible owned canonical world Actor is required');
  return user;
}
export async function invokeAdapter(
  ctx: OpContext,
  uuid: string,
  schema: z.ZodObject,
  invoke: (
    adapter: SystemAdapter,
    actor: unknown,
    execution?: AdapterExecutionContext,
  ) => unknown | Promise<unknown>,
  write = false,
): Promise<DispatchResult> {
  try {
    let actor = await fromUuidCompat(uuid);
    checkActor(ctx, actor, uuid);
    let execution: AdapterExecutionContext | undefined;
    if (write) {
      const w = ctx as WriteContext;
      await w.snapshot(uuid);
      actor = await fromUuidCompat(uuid);
      const user = checkActor(ctx, actor, uuid);
      execution = Object.freeze({
        user,
        callOptions: w.callOptions,
        snapshot: w.snapshot,
        intendCreate: w.intendCreate,
        created: w.created,
      });
    }
    // No await occurs between this final authorization and selecting/invoking the adapter.
    checkActor(ctx, actor, uuid);
    const systemId = game.system?.id;
    if (typeof systemId !== 'string' || !systemId || systemId.length > 100)
      throw Error('Invalid system identity');
    const result = boundedAdapterData(await invoke(selectAdapter(systemId), actor, execution));
    if (!result || typeof result !== 'object' || Array.isArray(result))
      throw Error('Invalid adapter result');
    const structured = schema.parse({ ...result, actorUuid: uuid, systemId });
    const text = JSON.stringify(structured);
    if (new TextEncoder().encode(text).length > 65536)
      throw Error('Adapter result exceeds byte cap');
    return { text, structured };
  } catch (error) {
    if (error instanceof WriteError) return { error: { code: error.code, message: error.message } };
    if (error instanceof AdapterUnsupportedError) {
      const id = typeof game.system?.id === 'string' ? game.system.id.slice(0, 100) : 'unknown';
      return { error: { code: 'INVALID_ARGS', message: `Operation not supported for ${id}` } };
    }
    return { error: { code: 'INTERNAL', message: 'System adapter returned an invalid result' } };
  }
}
