/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  OpAdmissionError,
  type AdmissionContext,
  type OpContext,
  type DispatchResult,
} from '../ops/types.js';

declare const game: any;
const invalid = (message: string): never => {
  throw new Error(message);
};
export function codeGM(ctx: Pick<OpContext, 'user'>): any {
  const user = game.users?.get(ctx.user.id);
  if (!user || game.user !== user || user.isGM !== true)
    throw new OpAdmissionError('FORBIDDEN', 'A current native GM is required');
  return user;
}
export function approvedCode(ctx: OpContext): any {
  const user = codeGM(ctx);
  if (
    ctx.approved !== true ||
    typeof ctx.callId !== 'string' ||
    !ctx.callId ||
    ctx.callOptions?.agentGateway?.callId !== ctx.callId
  )
    throw new OpAdmissionError('FORBIDDEN', 'An approved audited code call is required');
  return user;
}
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
/** Descriptor-only JSON traversal: never execute getters or toJSON while serializing a return. */
export function codeResult(value: unknown, strict = false): { result: string; truncated: boolean } {
  const NativeChatMessage = (globalThis as any).foundry?.documents?.ChatMessage?.implementation;
  if (!strict && typeof NativeChatMessage === 'function' && value instanceof NativeChatMessage) {
    const source = Object.getOwnPropertyDescriptor(value, '_source');
    const id =
      source &&
      'value' in source &&
      source.value &&
      Object.getOwnPropertyDescriptor(source.value, '_id');
    if (
      !id ||
      !('value' in id) ||
      typeof id.value !== 'string' ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(id.value) ||
      game.messages?.get(id.value) !== value
    )
      invalid('The returned native ChatMessage is not canonical');
    value = { uuid: `ChatMessage.${id.value}` };
  }
  let nodes = 0;
  let output = '';
  let truncated = false;
  const seen = new WeakSet<object>();
  const append = (s: string) => {
    if (output.length + s.length > 4000) truncated = true;
    output = (output + s.slice(0, 4001)).slice(0, 4000);
  };
  const quote = (s: string) => JSON.stringify(s.slice(0, 4001));
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > 5000 || depth > 16) invalid('Code value exceeds traversal bounds');
    if (v === null) {
      append('null');
      return;
    }
    if (typeof v === 'string') {
      if (v.length > 4001) truncated = true;
      append(quote(v));
      return;
    }
    if (typeof v === 'boolean') {
      append(String(v));
      return;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      append(String(v));
      return;
    }
    if (v === undefined && depth === 0 && !strict) {
      append('undefined');
      return;
    }
    if (!v || typeof v !== 'object') invalid('Code value is not supported JSON');
    const object = v as object;
    if (seen.has(object)) invalid('Code value contains a cycle or repeated reference');
    seen.add(object);
    const array = Array.isArray(object);
    if (
      Object.getPrototypeOf(object) !== (array ? Array.prototype : Object.prototype) &&
      !(Object.getPrototypeOf(object) === null && !array)
    )
      invalid('Code value must contain plain JSON data');
    if (array) {
      const length = Object.getOwnPropertyDescriptor(object, 'length')?.value;
      if (!Number.isSafeInteger(length) || length > 5000) invalid('Code arrays exceed bounds');
    }
    const keys = Reflect.ownKeys(object);
    if (keys.length > 5001 || keys.some((k) => typeof k !== 'string' || unsafe.has(k)))
      invalid('Code value contains unsafe keys or exceeds bounds');
    if (array) {
      const length = Object.getOwnPropertyDescriptor(object, 'length')?.value;
      if (!Number.isSafeInteger(length) || length > 5000 || keys.length !== length + 1)
        invalid('Code arrays must be bounded and contiguous');
      append('[');
      for (let i = 0; i < length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(object, String(i));
        if (!descriptor || !('value' in descriptor))
          invalid('Code arrays cannot contain accessors or holes');
        if (i) append(',');
        visit(descriptor!.value, depth + 1);
      }
      append(']');
    } else {
      append('{');
      let first = true;
      for (const key of keys as string[]) {
        const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
        if (!('value' in descriptor)) invalid('Code objects cannot contain accessors');
        if (!descriptor.enumerable) continue;
        if (!first) append(',');
        first = false;
        append(quote(key));
        append(':');
        visit(descriptor!.value, depth + 1);
      }
      append('}');
    }
    seen.delete(object);
  };
  visit(value, 0);
  return { result: output, truncated };
}
export function parseCodeArgs(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  if (new TextEncoder().encode(text).length > 65536)
    throw new OpAdmissionError('INVALID_ARGS', 'Macro args exceed 64 KiB UTF-8');
  let value: unknown;
  try {
    value = JSON.parse(text);
    codeResult(value, true);
  } catch {
    throw new OpAdmissionError('INVALID_ARGS', 'Macro args must be bounded safe JSON');
  }
  return value;
}
export function codeError(error: unknown): DispatchResult {
  try {
    if (error instanceof OpAdmissionError)
      return { error: { code: error.code, message: error.message.slice(0, 4000) } };
    const descriptor =
      error && typeof error === 'object'
        ? Object.getOwnPropertyDescriptor(error, 'message')
        : undefined;
    const message =
      typeof error === 'string'
        ? error
        : descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
          ? descriptor.value
          : 'Code execution failed';
    return { error: { code: 'INTERNAL', message: message.slice(0, 4000) } };
  } catch {
    return { error: { code: 'INTERNAL', message: 'Code execution failed' } };
  }
}
export type CodeAdmission = AdmissionContext;
