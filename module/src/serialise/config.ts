export const SERIALISE_CONFIG = {
  /** Default page size, in characters. */
  defaultPageSize: 8000,
  /** A table with more columns than this is emitted as flattened text rows, not a GFM table. */
  maxTableColumns: 64,
  /** A page continuing a table repeats the header only if it takes at most this share of the page
   * limit (or at most twice a blank header); a longer one is replaced by a blank header, so its size
   * never multiplies by the number of pages. */
  maxRepeatedHeaderShare: 0.5,
} as const;
