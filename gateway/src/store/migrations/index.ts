import m001 from './001-pairings.js';

/**
 * Ordered, insertion-only registry. Each task adds one static import and one
 * array entry. Static imports keep this bundle-safe: no directory scan.
 */
export const MIGRATIONS: readonly string[] = [m001];
