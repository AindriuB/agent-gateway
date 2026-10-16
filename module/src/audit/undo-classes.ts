/**
 * World document classes undo may touch (update, delete or recreate). Deliberately not `User`,
 * `Setting`, `Macro`, `Adventure` or anything that carries credentials, scripts or world config.
 */
export const UNDO_CLASSES: readonly string[] = [
  'Actor',
  'Item',
  'JournalEntry',
  'Scene',
  'RollTable',
  'Playlist',
  'Cards',
  'Folder',
  'ChatMessage',
];

/** Embedded document classes undo may recreate inside an allowed parent. */
export const UNDO_EMBEDDED: readonly string[] = [
  'Item',
  'ActiveEffect',
  'JournalEntryPage',
  'Token',
  'Tile',
  'Drawing',
  'Note',
  'Wall',
  'AmbientLight',
  'AmbientSound',
  'MeasuredTemplate',
  'TableResult',
  'PlaylistSound',
  'Card',
  'Level',
];

/** The class of the document a uuid names, and of its root; null for a uuid undo will not handle. */
export function undoClasses(uuid: string): { root: string; own: string } | null {
  const parts = uuid.split('.');
  if (parts.length < 2 || parts.length % 2 !== 0) return null;
  const root = parts[0]!;
  const own = parts[parts.length - 2]!;
  if (!UNDO_CLASSES.includes(root)) return null;
  if (parts.length > 2 && !UNDO_EMBEDDED.includes(own)) return null;
  return { root, own };
}
