/* eslint-disable @typescript-eslint/no-explicit-any */
import { compendiumSearch } from '@agent-gateway/protocol';
import type { OpHandler } from '../ops/types.js';
import { inlineText } from '../serialise/index.js';

declare const game: any;

const NAME_CAP = 200;

/**
 * Pack document types a compendium tool will search or read. An Adventure holds whole worlds' worth of
 * GM data in set fields that the embedded-visibility rules cannot see into, so it is GM only; any type
 * not listed (including future ones) is refused for everyone.
 */
const PACK_TYPES = [
  'Actor',
  'Item',
  'JournalEntry',
  'RollTable',
  'Macro',
  'Playlist',
  'Scene',
  'Cards',
];
export const packTypeAllowed = (type: unknown, isGM: boolean): boolean =>
  typeof type === 'string' && (PACK_TYPES.includes(type) || (isGM && type === 'Adventure'));

/** True when the user may observe the pack. Unknown users and packs without the API are denied. */
export function canObservePack(pack: any, userId: string): boolean {
  const user = game.users?.get(userId);
  if (!user || typeof pack?.testUserPermission !== 'function') return false;
  return pack.testUserPermission(user, 'OBSERVER') === true;
}

export const compendiumSearchHandler: OpHandler = async (ctx) => {
  const { query, packType, pack: packId, limit } = compendiumSearch.input.parse(ctx.args);
  const needle = query.toLowerCase();
  const results: Array<{ uuid: string; name: string; type: string; pack: string }> = [];
  let truncated = false;

  search: for (const pack of game.packs.contents as any[]) {
    if (!packTypeAllowed(pack.documentName, ctx.user.isGM)) continue;
    if (packType && pack.documentName !== packType) continue;
    if (packId && pack.collection !== packId) continue;
    if (!canObservePack(pack, ctx.user.id)) continue;
    // The index only: whole packs are never loaded.
    const index = await pack.getIndex();
    for (const entry of index.contents ?? [...index]) {
      const name = String(entry?.name ?? '');
      if (!name.toLowerCase().includes(needle)) continue;
      if (results.length >= limit) {
        truncated = true;
        break search;
      }
      results.push({
        uuid: String(
          entry.uuid ?? `Compendium.${pack.collection}.${pack.documentName}.${entry._id}`,
        ),
        name: name.length > NAME_CAP ? name.slice(0, NAME_CAP) : name,
        type: String(entry.type ?? pack.documentName),
        pack: String(pack.collection),
      });
    }
  }

  const lines = results.map(
    (r) =>
      `- ${inlineText(r.name)} (${inlineText(r.type)}, ${inlineText(r.pack)}): ${inlineText(r.uuid, 500)}`,
  );
  const head = results.length
    ? `${results.length} compendium ${results.length === 1 ? 'entry' : 'entries'}${truncated ? ' (more matched; raise limit or narrow the search)' : ''}:`
    : 'No compendium entries matched.';
  return { text: [head, ...lines].join('\n'), structured: { results, truncated } };
};
