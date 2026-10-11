export interface DiffRow {
  path: string;
  old: string;
  new: string;
}

/** Bounds review work before recursive diffing/stringifying; oversized requests remain deniable. */
export function reviewable(value: unknown): boolean {
  const stack = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let chars = 0;
  while (stack.length) {
    const job = stack.pop()!;
    if (++nodes > 20000 || job.depth > 64) return false;
    if (typeof job.value === 'string') chars += job.value.length;
    if (chars > 1000000) return false;
    if (job.value !== null && typeof job.value === 'object') {
      if (seen.has(job.value)) return false;
      seen.add(job.value);
      for (const key in job.value) {
        if (!Object.hasOwn(job.value, key)) continue;
        const child = (job.value as Record<string, unknown>)[key];
        chars += key.length;
        if (stack.length >= 20000 || chars > 1000000) return false;
        stack.push({ value: child, depth: job.depth + 1 });
      }
    }
  }
  return true;
}

export function pretty(value: unknown): string {
  if (!reviewable(value)) throw new RangeError('Approval value exceeds review bounds');
  return value === undefined ? '—' : JSON.stringify(value, null, 2);
}

/** Objects and arrays share paths; additions/removals retain an explicit missing value. */
export function computeDiff(before: unknown, after: unknown): DiffRow[] {
  if (!reviewable(before) || !reviewable(after))
    throw new RangeError('Approval diff exceeds review bounds');
  const rows: DiffRow[] = [];
  const visit = (old: unknown, next: unknown, path: string): void => {
    if (Object.is(old, next)) return;
    if (
      old !== null &&
      next !== null &&
      typeof old === 'object' &&
      typeof next === 'object' &&
      Array.isArray(old) === Array.isArray(next)
    ) {
      const a = old as Record<string, unknown>;
      const b = next as Record<string, unknown>;
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        visit(
          a[key],
          b[key],
          Array.isArray(old) ? `${path}[${key}]` : path ? `${path}.${key}` : key,
        );
      }
    } else {
      if (rows.length >= 1000) throw new RangeError('Approval diff exceeds row limit');
      rows.push({ path: path || '$', old: pretty(old), new: pretty(next) });
    }
  };
  visit(before, after, '');
  return rows;
}

/** Apply Foundry-style dotted changes to a copy; never assign prototype properties. */
export function updatedDocument(before: object, changes: Record<string, unknown>): object {
  if (!reviewable(before) || !reviewable(changes))
    throw new RangeError('Approval update exceeds review bounds');
  const after = structuredClone(before) as Record<string, unknown>;
  const apply = (target: Record<string, unknown>, patch: Record<string, unknown>): void => {
    for (const [path, value] of Object.entries(patch)) {
      const parts = path.split('.');
      if (parts.some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) continue;
      let node = target;
      for (const part of parts.slice(0, -1)) {
        if (!node[part] || typeof node[part] !== 'object') node[part] = {};
        node = node[part] as Record<string, unknown>;
      }
      const key = parts.at(-1)!;
      if (key.startsWith('-=')) delete node[key.slice(2)];
      else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        if (!node[key] || typeof node[key] !== 'object') node[key] = {};
        apply(node[key] as Record<string, unknown>, value as Record<string, unknown>);
      } else node[key] = structuredClone(value);
    }
  };
  apply(after, changes);
  return after;
}
