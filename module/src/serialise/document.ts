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
    // Root flags, then every embedded document (object with string `_id` and object `flags`).
    // Iterative so deep data cannot overflow the stack.
    if (data.flags && typeof data.flags === 'object') strip(data.flags);
    const stack: unknown[] = [data];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      const rec = node as Record<string, any>;
      if (
        node !== data &&
        !Array.isArray(node) &&
        typeof rec._id === 'string' &&
        rec.flags &&
        typeof rec.flags === 'object' &&
        !Array.isArray(rec.flags)
      ) {
        strip(rec.flags);
      }
      for (const v of Object.values(rec)) if (v && typeof v === 'object') stack.push(v);
    }
  }
  return data;
}
