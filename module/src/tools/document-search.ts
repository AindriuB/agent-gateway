/* eslint-disable @typescript-eslint/no-explicit-any */
import type { OpHandler } from '../ops/types.js';
import { inlineText } from '../serialise/index.js';
import { presentedName, rootVisible } from './visibility.js';

declare const game: any;

/** World collection (a property of `game`) holding each searchable document type. */
const COLLECTIONS: Record<string, string> = {
  Actor: 'actors',
  Item: 'items',
  JournalEntry: 'journal',
  Scene: 'scenes',
  RollTable: 'tables',
  Macro: 'macros',
  Playlist: 'playlists',
};

interface SearchArgs {
  type: string;
  query?: string;
  folder?: string;
  limit: number;
}

export const documentSearchHandler: OpHandler = (ctx) => {
  const args = ctx.args as SearchArgs;
  const user = game.users.get(ctx.user.id);
  const docs: any[] = Array.from(game[COLLECTIONS[args.type]!]?.contents ?? []);
  const query = args.query?.toLowerCase();
  const folder = args.folder?.toLowerCase();
  const matches = docs
    .filter((d) => {
      if (!user || !d.testUserPermission(user, 'OBSERVER') || !rootVisible(d, user)) return false;
      if (query && !presentedName(d, user).toLowerCase().includes(query)) return false;
      if (folder) {
        const f = d.folder;
        if (!f || (f.id?.toLowerCase() !== folder && String(f.name ?? '').toLowerCase() !== folder))
          return false;
      }
      return true;
    })
    .map((d) => ({
      uuid: String(d.uuid),
      name: presentedName(d, user),
      type: args.type,
      folder: String(d.folder?.name ?? ''),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.uuid.localeCompare(b.uuid));
  const results = matches.slice(0, args.limit);
  const truncated = matches.length > results.length;
  const lines = results.map(
    (r) =>
      `- ${inlineText(r.name)} (${inlineText(r.uuid)})${r.folder ? ` in ${inlineText(r.folder)}` : ''}`,
  );
  const text =
    `${results.length} of ${matches.length} ${args.type} documents` +
    `${truncated ? ' (truncated; narrow the query)' : ''}.` +
    (lines.length ? `\n${lines.join('\n')}` : '');
  return { text, structured: { results, total: matches.length, truncated } };
};
