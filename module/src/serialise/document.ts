/* eslint-disable @typescript-eslint/no-explicit-any */
declare const game: any;

const NS = 'agent-gateway';

export interface SerialiseOptions {
  includeOtherModuleData?: boolean;
}

export function includeOtherModuleDataSetting(): boolean {
  return game.settings.get(NS, 'includeOtherModuleData') === true;
}

/** Plain JSON copy of a document, with other modules' flags stripped unless opted in. */
export function serialiseDocument(
  doc: any,
  opts: SerialiseOptions = { includeOtherModuleData: includeOtherModuleDataSetting() },
): Record<string, unknown> {
  const raw = typeof doc?.toObject === 'function' ? doc.toObject() : doc;
  const data = JSON.parse(JSON.stringify(raw ?? {})) as Record<string, any>;
  if (!opts.includeOtherModuleData) {
    const keep = new Set(['core', game.system?.id, NS]);
    const strip = (flags: Record<string, unknown>) => {
      for (const key of Object.keys(flags)) {
        if (!keep.has(key)) delete flags[key];
      }
    };
    // Filter every `flags` object in the tree except those under a `system` path segment
    // (system data may use `flags` for its own purposes). Embedded documents such as
    // prototypeToken carry flags without an `_id`, so no document heuristic is used.
    // Iterative so deep data cannot overflow the stack.
    const stack: Array<[unknown, boolean]> = [[data, false]];
    while (stack.length) {
      const [node, inSystem] = stack.pop()!;
      if (!node || typeof node !== 'object') continue;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (!v || typeof v !== 'object') continue;
        if (k === 'flags' && !inSystem && !Array.isArray(v)) {
          strip(v as Record<string, unknown>);
          continue;
        }
        stack.push([v, inSystem || k === 'system']);
      }
    }
  }
  return data;
}
