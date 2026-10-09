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
  if (!opts.includeOtherModuleData && data.flags && typeof data.flags === 'object') {
    const keep = new Set(['core', game.system?.id, NS]);
    for (const key of Object.keys(data.flags)) {
      if (!keep.has(key)) delete data.flags[key];
    }
  }
  return data;
}
