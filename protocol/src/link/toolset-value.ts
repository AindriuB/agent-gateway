import { TOOL_LIMITS } from '../tools/limits.js';

export type ToolsetSnapshot = { ok: true; value: unknown } | { ok: false };

/** Copy JSON data iteratively before any recursive serializer or schema walk sees it. */
export function snapshotToolsetValue(value: unknown, startingDepth = 0): ToolsetSnapshot {
  try {
    const root: { value?: unknown } = {};
    type Job = { value: unknown; depth: number; target: object; key: string } | { exit: object };
    const stack: Job[] = [{ value, depth: startingDepth, target: root, key: 'value' }];
    const ancestors = new Set<object>();
    let remaining = TOOL_LIMITS.announcementWork;
    while (stack.length) {
      const job = stack.pop()!;
      if ('exit' in job) {
        ancestors.delete(job.exit);
        continue;
      }
      const current = job.value;
      remaining -= 1 + (typeof current === 'string' ? current.length : 0);
      if (remaining < 0 || job.depth > TOOL_LIMITS.announcementDepth) return { ok: false };
      let copy: unknown;
      if (current === null || typeof current === 'string' || typeof current === 'boolean')
        copy = current;
      else if (typeof current === 'number' && Number.isFinite(current)) copy = current;
      else if (typeof current === 'object') {
        if (ancestors.has(current)) return { ok: false };
        const array = Array.isArray(current);
        const prototype = Object.getPrototypeOf(current);
        if (
          prototype !== (array ? Array.prototype : Object.prototype) &&
          !(prototype === null && !array)
        )
          return { ok: false };
        const descriptors = Object.getOwnPropertyDescriptors(current);
        const keys = Reflect.ownKeys(descriptors);
        if (keys.length > remaining) return { ok: false };
        const length = array ? (descriptors.length?.value as number) : 0;
        if (array && (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1))
          return { ok: false };
        copy = array ? [] : {};
        ancestors.add(current);
        stack.push({ exit: current });
        for (const key of keys) {
          if (array && key === 'length') continue;
          if (typeof key !== 'string') return { ok: false };
          remaining -= key.length;
          if (remaining < 0) return { ok: false };
          const descriptor = descriptors[key]!;
          if (!descriptor.enumerable || !('value' in descriptor)) return { ok: false };
          if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length))
            return { ok: false };
          stack.push({
            value: descriptor.value,
            depth: job.depth + 1,
            target: copy as object,
            key,
          });
        }
      } else return { ok: false };
      Object.defineProperty(job.target, job.key, {
        value: copy,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return { ok: true, value: root.value };
  } catch {
    return { ok: false };
  }
}
