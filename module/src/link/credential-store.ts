/**
 * Pairing tokens, kept in this browser only. Foundry settings and flags are stored on the server
 * where a GM or the world files can read them, so a token never goes there. One map, keyed by
 * (gateway URL, world id, Foundry user id): a second user in the same browser never sees,
 * sends or clears the first user's token.
 */

/** The most entries kept; adding one beyond this evicts the least recently used. */
export const MAX_CREDENTIALS = 16;

export const CREDENTIAL_STORAGE_KEY = 'agent-gateway.pairingCredentials';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CredentialOwner {
  url: string;
  worldId: string;
  userId: string;
}

interface Entry {
  token: string;
  at: number;
}

function normalizeUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

export function credentialKey(o: CredentialOwner): string {
  return JSON.stringify([normalizeUrl(o.url), o.worldId, o.userId]);
}

export interface CredentialStore {
  get(owner: CredentialOwner): string | null;
  set(owner: CredentialOwner, token: string): void;
  /** Refresh the entry's timestamp (an accepted token-auth welcome). */
  touch(owner: CredentialOwner): void;
  remove(owner: CredentialOwner): void;
  size(): number;
  /** True if any entry, for any gateway, belongs to this world and user. */
  hasUser(worldId: string, userId: string): boolean;
}

/** In-memory fallback when no browser storage is available. */
export function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

export function createCredentialStore(
  storage: StorageLike,
  now: () => number = () => Date.now(),
): CredentialStore {
  const read = (): Record<string, Entry> => {
    const out: Record<string, Entry> = {};
    try {
      const raw = storage.getItem(CREDENTIAL_STORAGE_KEY);
      if (!raw) return out;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const e = v as Partial<Entry> | null;
        if (e && typeof e.token === 'string' && e.token && typeof e.at === 'number') {
          out[k] = { token: e.token, at: e.at };
        }
      }
    } catch {
      // Missing, unparsable or unreadable storage counts as empty.
    }
    return out;
  };
  const write = (map: Record<string, Entry>): void => {
    try {
      storage.setItem(CREDENTIAL_STORAGE_KEY, JSON.stringify(map));
    } catch {
      // Storage full or blocked: the link still works for this session.
    }
  };
  return {
    get: (o) => read()[credentialKey(o)]?.token ?? null,
    set(o, token) {
      const map = read();
      const own = credentialKey(o);
      map[own] = { token, at: now() };
      const others = Object.keys(map).filter((k) => k !== own);
      const excess = others.length + 1 - MAX_CREDENTIALS;
      if (excess > 0) {
        others.sort((a, b) => map[a]!.at - map[b]!.at);
        for (const k of others.slice(0, excess)) delete map[k];
      }
      write(map);
    },
    touch(o) {
      const map = read();
      const e = map[credentialKey(o)];
      if (!e) return;
      e.at = now();
      write(map);
    },
    remove(o) {
      const map = read();
      if (delete map[credentialKey(o)]) write(map);
    },
    size: () => Object.keys(read()).length,
    hasUser: (worldId, userId) =>
      Object.keys(read()).some((k) => {
        try {
          const p: unknown = JSON.parse(k);
          return Array.isArray(p) && p[1] === worldId && p[2] === userId;
        } catch {
          return false;
        }
      }),
  };
}
