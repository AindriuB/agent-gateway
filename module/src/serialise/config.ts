export const SERIALISE_CONFIG = {
  /** Default page size, in characters. */
  defaultPageSize: 8000,
  /** A table with more columns than this is emitted as flattened text rows, not a GFM table. */
  maxTableColumns: 64,
} as const;
