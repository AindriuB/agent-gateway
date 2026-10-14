import type { DatabaseSync } from 'node:sqlite';

export const SCOPES = ['read', 'write', 'destructive', 'code'] as const;
export type Scope = (typeof SCOPES)[number];

export interface OAuthClient {
  id: string;
  secretHash: string | null;
  name: string;
  redirectUris: string[];
  createdAt: number;
  lastUsedAt: number | null;
}

export interface OAuthGrant {
  id: string;
  clientId: string;
  worldId: string;
  userId: string;
  scopes: Scope[];
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface OAuthCode {
  codeHash: string;
  grantId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  expiresAt: number;
  usedAt: number | null;
}

export interface OAuthTokenRow {
  tokenHash: string;
  kind: 'access' | 'refresh';
  grantId: string;
  familyId: string;
  audience: string;
  expiresAt: number;
  revokedAt: number | null;
  replacedBy: string | null;
}

/** A live access token joined with its live grant. */
export interface AccessRecord {
  token: OAuthTokenRow;
  grant: OAuthGrant;
}

/**
 * SQL for the OAuth server. Secrets (client secrets, codes, tokens) are passed in already hashed:
 * nothing here ever sees one in the clear.
 */
export interface OAuthRepository {
  countClients(): number;
  createClient(c: Omit<OAuthClient, 'lastUsedAt'>): void;
  getClient(id: string): OAuthClient | undefined;
  touchClient(id: string, now: number): void;
  /** Delete clients created before `olderThan` that have no grant. Returns how many. */
  pruneClients(olderThan: number): number;

  createGrant(g: Omit<OAuthGrant, 'lastUsedAt' | 'revokedAt'>): void;
  getGrant(id: string): OAuthGrant | undefined;
  touchGrant(id: string, now: number): void;
  /** Revoke one grant and every token of it. True when it was live. */
  revokeGrant(id: string, now: number): boolean;
  /** Revoke every live grant of a (world, user) and their tokens. Returns the grants revoked. */
  revokeGrantsFor(worldId: string, userId: string, now: number): number;

  insertCode(c: Omit<OAuthCode, 'usedAt'>): void;
  getCode(codeHash: string): OAuthCode | undefined;
  /** Mark a code used. False when it was already used (a replay). */
  useCode(codeHash: string, now: number): boolean;

  insertToken(t: Omit<OAuthTokenRow, 'revokedAt' | 'replacedBy'>): void;
  getToken(tokenHash: string): OAuthTokenRow | undefined;
  /** The unrevoked access token and its live grant, or undefined. Expiry is the caller's check. */
  getAccess(tokenHash: string): AccessRecord | undefined;
  /** Atomically retire a refresh token in favour of its successor. False when already retired. */
  rotateRefresh(oldHash: string, newHash: string): boolean;
  revokeFamily(familyId: string, now: number): void;
}

const SCOPE_SET: ReadonlySet<string> = new Set(SCOPES);

interface ClientRow {
  id: string;
  secret_hash: string | null;
  name: string;
  redirect_uris: string;
  created_at: number;
  last_used_at: number | null;
}
interface GrantRow {
  id: string;
  client_id: string;
  world_id: string;
  user_id: string;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}
interface CodeRow {
  code_hash: string;
  grant_id: string;
  redirect_uri: string;
  code_challenge: string;
  resource: string;
  expires_at: number;
  used_at: number | null;
}
interface TokenRow {
  token_hash: string;
  kind: 'access' | 'refresh';
  grant_id: string;
  family_id: string;
  audience: string;
  expires_at: number;
  revoked_at: number | null;
  replaced_by: string | null;
}

const toClient = (r: ClientRow): OAuthClient => ({
  id: r.id,
  secretHash: r.secret_hash,
  name: r.name,
  redirectUris: JSON.parse(r.redirect_uris) as string[],
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
});
const toGrant = (r: GrantRow): OAuthGrant => ({
  id: r.id,
  clientId: r.client_id,
  worldId: r.world_id,
  userId: r.user_id,
  scopes: r.scopes.split(' ').filter((s): s is Scope => SCOPE_SET.has(s)),
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
  revokedAt: r.revoked_at,
});
const toCode = (r: CodeRow): OAuthCode => ({
  codeHash: r.code_hash,
  grantId: r.grant_id,
  redirectUri: r.redirect_uri,
  codeChallenge: r.code_challenge,
  resource: r.resource,
  expiresAt: r.expires_at,
  usedAt: r.used_at,
});
const toToken = (r: TokenRow): OAuthTokenRow => ({
  tokenHash: r.token_hash,
  kind: r.kind,
  grantId: r.grant_id,
  familyId: r.family_id,
  audience: r.audience,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
  replacedBy: r.replaced_by,
});

export function createOAuthRepository(db: DatabaseSync): OAuthRepository {
  // A savepoint works on its own and inside a caller's open transaction (68's redeem), where a
  // nested BEGIN would throw. An outer rollback undoes it.
  const tx = <T>(fn: () => T): T => {
    db.exec('SAVEPOINT oauth_tx');
    try {
      const out = fn();
      db.exec('RELEASE oauth_tx');
      return out;
    } catch (e) {
      db.exec('ROLLBACK TO oauth_tx');
      db.exec('RELEASE oauth_tx');
      throw e;
    }
  };
  const count = db.prepare('SELECT count(*) AS n FROM oauth_clients');
  const insClient = db.prepare(
    'INSERT INTO oauth_clients (id, secret_hash, name, redirect_uris, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const getClient = db.prepare('SELECT * FROM oauth_clients WHERE id = ?');
  const touchClient = db.prepare('UPDATE oauth_clients SET last_used_at = ? WHERE id = ?');
  const pruneClients = db.prepare(
    'DELETE FROM oauth_clients WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = oauth_clients.id)',
  );
  const insGrant = db.prepare(
    'INSERT INTO oauth_grants (id, client_id, world_id, user_id, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const getGrant = db.prepare('SELECT * FROM oauth_grants WHERE id = ?');
  const touchGrant = db.prepare('UPDATE oauth_grants SET last_used_at = ? WHERE id = ?');
  const revokeGrantRow = db.prepare(
    'UPDATE oauth_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
  );
  const revokeGrantTokens = db.prepare(
    'UPDATE oauth_tokens SET revoked_at = ? WHERE grant_id = ? AND revoked_at IS NULL',
  );
  const liveGrantsFor = db.prepare(
    'SELECT id FROM oauth_grants WHERE world_id = ? AND user_id = ? AND revoked_at IS NULL',
  );
  const insCode = db.prepare(
    'INSERT INTO oauth_codes (code_hash, grant_id, redirect_uri, code_challenge, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const getCode = db.prepare('SELECT * FROM oauth_codes WHERE code_hash = ?');
  const useCode = db.prepare(
    'UPDATE oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL',
  );
  const insToken = db.prepare(
    'INSERT INTO oauth_tokens (token_hash, kind, grant_id, family_id, audience, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const getToken = db.prepare('SELECT * FROM oauth_tokens WHERE token_hash = ?');
  const retire = db.prepare(
    'UPDATE oauth_tokens SET replaced_by = ? WHERE token_hash = ? AND replaced_by IS NULL AND revoked_at IS NULL',
  );
  const revokeFamily = db.prepare(
    'UPDATE oauth_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL',
  );
  const revokeGrant = (id: string, now: number): boolean => {
    const changed = Number(revokeGrantRow.run(now, id).changes) > 0;
    revokeGrantTokens.run(now, id);
    return changed;
  };
  return {
    countClients: () => (count.get() as { n: number }).n,
    createClient: (c) => {
      insClient.run(c.id, c.secretHash, c.name, JSON.stringify(c.redirectUris), c.createdAt);
    },
    getClient: (id) => {
      const r = getClient.get(id) as ClientRow | undefined;
      return r ? toClient(r) : undefined;
    },
    touchClient: (id, now) => {
      touchClient.run(now, id);
    },
    pruneClients: (olderThan) => Number(pruneClients.run(olderThan).changes),
    createGrant: (g) => {
      insGrant.run(g.id, g.clientId, g.worldId, g.userId, g.scopes.join(' '), g.createdAt);
    },
    getGrant: (id) => {
      const r = getGrant.get(id) as GrantRow | undefined;
      return r ? toGrant(r) : undefined;
    },
    touchGrant: (id, now) => {
      touchGrant.run(now, id);
    },
    revokeGrant: (id, now) => tx(() => revokeGrant(id, now)),
    revokeGrantsFor: (worldId, userId, now) =>
      tx(() => {
        const ids = liveGrantsFor.all(worldId, userId) as { id: string }[];
        for (const { id } of ids) revokeGrant(id, now);
        return ids.length;
      }),
    insertCode: (c) => {
      insCode.run(c.codeHash, c.grantId, c.redirectUri, c.codeChallenge, c.resource, c.expiresAt);
    },
    getCode: (h) => {
      const r = getCode.get(h) as CodeRow | undefined;
      return r ? toCode(r) : undefined;
    },
    useCode: (h, now) => Number(useCode.run(now, h).changes) > 0,
    insertToken: (t) => {
      insToken.run(t.tokenHash, t.kind, t.grantId, t.familyId, t.audience, t.expiresAt);
    },
    getToken: (h) => {
      const r = getToken.get(h) as TokenRow | undefined;
      return r ? toToken(r) : undefined;
    },
    getAccess: (h) => {
      const t = getToken.get(h) as TokenRow | undefined;
      if (!t || t.kind !== 'access' || t.revoked_at !== null) return undefined;
      const g = getGrant.get(t.grant_id) as GrantRow | undefined;
      if (!g || g.revoked_at !== null) return undefined;
      return { token: toToken(t), grant: toGrant(g) };
    },
    rotateRefresh: (oldHash, newHash) => Number(retire.run(newHash, oldHash).changes) > 0,
    revokeFamily: (familyId, now) => {
      revokeFamily.run(now, familyId);
    },
  };
}
