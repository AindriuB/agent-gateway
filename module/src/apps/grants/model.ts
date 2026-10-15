import type { GrantSummary, UserGrantSummary } from '../../link/client.js';

export interface GrantRow {
  id: string;
  clientName: string;
  scopes: string;
  created: string;
  lastUsed: string;
}

const MAX_ROWS = 200;
const NAME_CHARS = 100;

const when = (ms: number | null): string =>
  ms !== null && Number.isFinite(ms) && ms > 0
    ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
    : '';

/** Printable text only, bounded: the client name comes from an unauthenticated registration. */
const plain = (s: unknown, max: number): string =>
  [...String(s ?? '').replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '')].slice(0, max).join('');

/** Plain strings for the template, which prints every one with `{{ }}` (escaped). */
export function grantRows(grants: readonly (GrantSummary | UserGrantSummary)[]): GrantRow[] {
  return grants.slice(0, MAX_ROWS).map((g) => ({
    id: String(g.id),
    clientName: plain(g.clientName, NAME_CHARS),
    scopes: g.scopes.join(', '),
    created: when(g.createdAt),
    lastUsed: 'lastUsedAt' in g ? when(g.lastUsedAt) : '',
  }));
}
