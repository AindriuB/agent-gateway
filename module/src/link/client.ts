import {
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  parseLinkMessage,
  type ErrorCode,
  type LinkMessage,
  type ResultImage,
} from '@agent-gateway/protocol/link';

export type HelloMessage = Extract<LinkMessage, { type: 'hello' }>;
export type CallMessage = Extract<LinkMessage, { type: 'call' }>;

export type CallResult =
  | { ok: true; text: string; structured?: unknown; images?: ResultImage[] }
  | { ok: false; code: ErrorCode; message: string };
export type CallHandler = (call: CallMessage) => Promise<CallResult> | CallResult;

export type LinkState =
  | {
      kind: 'disconnected';
      reason?: ErrorCode | 'ERROR' | 'REPLACED' | 'PAIRING_REQUIRED' | 'TOKEN_REJECTED';
    }
  | { kind: 'connecting'; codeRejected?: boolean }
  /** Paired with a valid invite; waiting for an admin GM to vouch for this user. */
  | { kind: 'awaiting-gm' }
  | { kind: 'connected'; user: string; world: string };

/** A pairing token bound to the gateway endpoint that issued it. */
export interface TokenCredential {
  url: string;
  token: string;
}

/** Canonical form of a gateway URL; two URLs name the same endpoint iff these are equal. */
export function normalizeGatewayUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

export interface SocketLike {
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  readyState?: number;
  send(data: string): void;
  close(): void;
}

/** The world and Foundry user a token belongs to. */
export interface TokenOwner {
  /** The gateway URL the socket connected to; absent means the current setting. */
  url?: string;
  worldId: string;
  userId: string;
}

export interface LinkClientDeps {
  getGatewayUrl(): string;
  /**
   * The stored credential as persisted (a JSON string). Only `{ url, token }` is honoured; anything else
   * counts as no token.
   */
  getToken(): unknown;
  /** Persist the token with the gateway URL that issued it, or clear it with `null`. */
  setToken(credential: TokenCredential | null, owner?: TokenOwner): Promise<unknown> | unknown;
  /** Mark the current user's stored token as just used (keeps it from being evicted). */
  touchToken?(owner?: TokenOwner): void;
  /** The old client-scoped credential, shared by every user of the browser. Read only for migration. */
  getLegacyToken?(): unknown;
  clearLegacyToken?(): Promise<unknown> | void;
  /** True if the current user has an entry for any gateway. Falls back to `getToken` when absent. */
  hasUserToken?(): boolean;
  /** True if this browser holds a token for some other user: a user with none then needs pairing. */
  hasOtherTokens?(): boolean;
  /** Everything in `hello` except `type`, `protocolVersion` and `auth`. */
  getIdentity(): Omit<HelloMessage, 'type' | 'protocolVersion' | 'auth'>;
  createSocket(url: string): SocketLike;
  notifyError(message: string): void;
  /**
   * Post the vouch chat message for this challenge nonce (task 90). Resolves false when it could
   * not be posted. The nonce must go nowhere else: not a log, a toast or a window.
   */
  postVouch?(nonce: string): Promise<boolean> | boolean;
  /** A non-fatal notice; the argument is an i18n key, localized by the caller. Never carries a token. */
  notifyWarn?(message: string): void;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Close code and reason the gateway uses when a newer connection for the same
 * user replaces this one: `ws.close(1000, 'replaced')` in gateway/src/link/server.ts.
 */
export const REPLACED_CLOSE_CODE = 1000;
export const REPLACED_CLOSE_REASON = 'replaced';

export type GrantSummary = Extract<LinkMessage, { type: 'grants' }>['grants'][number];
/** What an admin GM sees of a player's grant: no last-used time. */
export type UserGrantSummary = Extract<LinkMessage, { type: 'userGrants' }>['grants'][number];
export type ConsentCodeMessage = Extract<LinkMessage, { type: 'consentCode' }>;

/**
 * The first gateway version that answers `listGrants` and `revokeGrant`. Every build reports
 * `0.1.0`, so this gate cannot tell a gateway from before this task apart; it only stops the
 * module from sending to a gateway that reports a lower version.
 */
export const GRANTS_MIN_GATEWAY_VERSION = '0.1.0';

/** True when `version` is a plain `x.y.z` (a suffix is ignored) at or above `min`. */
export function gatewaySupportsGrants(
  version: string | null | undefined,
  min: string = GRANTS_MIN_GATEWAY_VERSION,
): boolean {
  const parse = (v: string | null | undefined): number[] | null => {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v ?? '');
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const have = parse(version);
  const need = parse(min);
  if (!have || !need) return false;
  for (let i = 0; i < 3; i++) {
    if ((have[i] as number) !== (need[i] as number))
      return (have[i] as number) > (need[i] as number);
  }
  return true;
}

export type InviteSummary = Extract<LinkMessage, { type: 'invites' }>['invites'][number];
export type PairingSummary = Extract<LinkMessage, { type: 'pairings' }>['pairings'][number];
export type InviteCreated = Extract<LinkMessage, { type: 'inviteCreated' }>;

/** The first gateway version that answers the invite messages (task 92). */
export const MANAGE_MIN_GATEWAY_VERSION = '0.2.0';
/** The first gateway version that answers the pairing messages; older ones close on them. */
export const PAIRINGS_MIN_GATEWAY_VERSION = '0.3.0';

/** A refused or failed management request; `code` is the gateway's error code or a local one. */
export class ManageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type ManageReply = Extract<
  LinkMessage,
  { type: 'invites' | 'inviteCreated' | 'pairings' | 'userGrants' }
>;

export const BACKOFF_MIN_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;

/** Exponential backoff capped at 60s first, then up to 20% downward jitter (never below 1s). */
export function backoffDelay(attempt: number, random: number): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt);
  return Math.max(BACKOFF_MIN_MS, Math.round(base * (1 - 0.2 * random)));
}

export class LinkClient {
  private socket: SocketLike | null = null;
  private readonly purges = new Map<
    string,
    {
      socket: SocketLike;
      resolve: (count: number) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private purgeSequence = 0;
  purgeEvents(): Promise<number> {
    const socket = this.socket;
    if (
      !socket ||
      this._state.kind !== 'connected' ||
      (socket.readyState !== undefined && socket.readyState !== 1)
    )
      return Promise.reject(new Error('Gateway offline'));
    if (this.purges.size >= 4) return Promise.reject(new Error('Too many pending purge requests'));
    const requestId = `purge-${++this.purgeSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.purges.delete(requestId);
        reject(new Error('Purge timed out'));
      }, 10000);
      this.purges.set(requestId, { socket, resolve, reject, timer });
      try {
        this.send({ type: 'purgeEvents', requestId });
      } catch (e) {
        clearTimeout(timer);
        this.purges.delete(requestId);
        reject(e);
      }
    });
  }
  /** The `gatewayVersion` from `welcome`; null while not connected. */
  gatewayVersion: string | null = null;
  private readonly grantRequests = new Map<
    string,
    {
      socket: SocketLike;
      resolve: (grants: GrantSummary[]) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private grantSequence = 0;
  private readonly consentListeners = new Set<(m: ConsentCodeMessage) => void>();
  /** Be told of each one-time consent code the gateway sends to this user. */
  onConsentCode(fn: (m: ConsentCodeMessage) => void): () => void {
    this.consentListeners.add(fn);
    return () => this.consentListeners.delete(fn);
  }
  /** This user's grants. Never sent to a gateway older than `GRANTS_MIN_GATEWAY_VERSION`. */
  listGrants(): Promise<GrantSummary[]> {
    return this.grantsRequest((requestId) => ({ type: 'listGrants', requestId }));
  }
  /** Revoke one of this user's grants; resolves to the grants that remain. */
  revokeGrant(grantId: string): Promise<GrantSummary[]> {
    return this.grantsRequest((requestId) => ({ type: 'revokeGrant', requestId, grantId }));
  }
  private grantsRequest(build: (requestId: string) => LinkMessage): Promise<GrantSummary[]> {
    const socket = this.socket;
    if (
      !socket ||
      this._state.kind !== 'connected' ||
      (socket.readyState !== undefined && socket.readyState !== 1)
    )
      return Promise.reject(new Error('Gateway offline'));
    if (!gatewaySupportsGrants(this.gatewayVersion))
      return Promise.reject(new Error('Gateway too old for grants'));
    if (this.grantRequests.size >= 4) return Promise.reject(new Error('Too many pending requests'));
    const requestId = `grants-${++this.grantSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.grantRequests.delete(requestId);
        reject(new Error('Grants request timed out'));
      }, 10000);
      this.grantRequests.set(requestId, { socket, resolve, reject, timer });
      try {
        this.send(build(requestId));
      } catch (e) {
        clearTimeout(timer);
        this.grantRequests.delete(requestId);
        reject(e);
      }
    });
  }
  private readonly manageRequests = new Map<
    string,
    {
      socket: SocketLike;
      expect: ManageReply['type'];
      /** The user a `userGrants` reply must be about. */
      forUser?: string;
      resolve: (reply: ManageReply) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private manageSequence = 0;
  /** The invites of this world (admin GM only). */
  async listInvites(): Promise<InviteSummary[]> {
    const r = await this.manageRequest('invites', (requestId) => ({
      type: 'listInvites',
      requestId,
    }));
    return (r as Extract<ManageReply, { type: 'invites' }>).invites;
  }
  /** Mint an invite for a player. The reply is the only place the code ever appears. */
  async createInvite(userId: string, ttlMs?: number): Promise<InviteCreated> {
    const r = await this.manageRequest('inviteCreated', (requestId) => ({
      type: 'createInvite',
      requestId,
      userId,
      ...(ttlMs === undefined ? {} : { ttlMs }),
    }));
    return r as InviteCreated;
  }
  /** Cancel one open invite; resolves to the invites that remain. */
  async cancelInvite(inviteId: string): Promise<InviteSummary[]> {
    const r = await this.manageRequest('invites', (requestId) => ({
      type: 'cancelInvite',
      requestId,
      inviteId,
    }));
    return (r as Extract<ManageReply, { type: 'invites' }>).invites;
  }
  /** The active pairings of this world (admin GM only). */
  async listPairings(): Promise<PairingSummary[]> {
    const r = await this.manageRequest('pairings', (requestId) => ({
      type: 'listPairings',
      requestId,
    }));
    return (r as Extract<ManageReply, { type: 'pairings' }>).pairings;
  }
  /** Revoke one pairing; resolves to the pairings that remain. */
  async revokePairing(pairingId: string): Promise<PairingSummary[]> {
    const r = await this.manageRequest('pairings', (requestId) => ({
      type: 'revokePairing',
      requestId,
      pairingId,
    }));
    return (r as Extract<ManageReply, { type: 'pairings' }>).pairings;
  }
  /** The authorized apps of one user in this world, as metadata only (admin GM only). */
  async listUserGrants(userId: string): Promise<UserGrantSummary[]> {
    const r = await this.manageRequest(
      'userGrants',
      (requestId) => ({ type: 'listUserGrants', requestId, userId }),
      userId,
    );
    return (r as Extract<ManageReply, { type: 'userGrants' }>).grants;
  }
  /** Revoke one of that user's grants; resolves to the grants that remain. */
  async revokeUserGrant(userId: string, grantId: string): Promise<UserGrantSummary[]> {
    const r = await this.manageRequest(
      'userGrants',
      (requestId) => ({ type: 'revokeUserGrant', requestId, userId, grantId }),
      userId,
    );
    return (r as Extract<ManageReply, { type: 'userGrants' }>).grants;
  }
  private manageRequest(
    expect: ManageReply['type'],
    build: (requestId: string) => LinkMessage,
    forUser?: string,
  ): Promise<ManageReply> {
    const socket = this.socket;
    if (
      !socket ||
      this._state.kind !== 'connected' ||
      (socket.readyState !== undefined && socket.readyState !== 1)
    )
      return Promise.reject(new ManageError('OFFLINE', 'Gateway offline'));
    if (!this.isAdmin) return Promise.reject(new ManageError('FORBIDDEN', 'Not an admin GM'));
    const min =
      expect === 'pairings' || expect === 'userGrants'
        ? PAIRINGS_MIN_GATEWAY_VERSION
        : MANAGE_MIN_GATEWAY_VERSION;
    if (!gatewaySupportsGrants(this.gatewayVersion, min))
      return Promise.reject(new ManageError('TOO_OLD', 'Gateway too old for management'));
    if (this.manageRequests.size >= 4)
      return Promise.reject(new ManageError('BUSY', 'Too many pending requests'));
    const requestId = `manage-${++this.manageSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.manageRequests.delete(requestId);
        reject(new ManageError('TIMEOUT', 'Request timed out'));
      }, 10000);
      this.manageRequests.set(requestId, { socket, expect, forUser, resolve, reject, timer });
      try {
        this.send(build(requestId));
      } catch (e) {
        clearTimeout(timer);
        this.manageRequests.delete(requestId);
        reject(e as Error);
      }
    });
  }
  sendEventPolicy(policy: { enabled: boolean; retentionDays: number }): void {
    if (this._state.kind === 'connected') this.sendMessage({ type: 'eventPolicy', ...policy });
  }
  private eventResume:
    | {
        url: string;
        worldId: string;
        userId: string;
        token: string;
        connectionId: string;
        lastSeq: number;
      }
    | undefined;
  private timer: unknown = null;
  private attempt = 0;
  private active = false;
  private code: string | null = null;
  /** Normalized gateway URL the code was entered for; a code is never sent anywhere else. */
  private codeUrl: string | null = null;
  /** What was live when stop() ran, for resume(). */
  private resumeMode: 'code' | 'token' | null = null;
  private codeRejected = false;
  /** Which credential the last hello carried, and the user it was sent as. */
  private authSource: 'code' | 'unstored' | 'keyed' | 'legacy' | null = null;
  private helloOwner: TokenOwner | null = null;
  private storageWarned = false;
  private listeners = new Set<(s: LinkState) => void>();
  /** The agent id the gateway assigned in `welcome`; null until connected. */
  agentId: string | null = null;
  private admin = false;
  private everAdmin = false;
  private welcomeHeadless = false;
  private welcomeOwner: string | null = null;
  private _state: LinkState = { kind: 'disconnected' };
  /** Injectable; with none installed every call is answered TOOL_NOT_FOUND. */
  onCall: CallHandler | null = null;
  onQueued:
    | ((
        call: Extract<LinkMessage, { type: 'queuedCalls' }>['calls'][number],
        current: () => boolean,
        report: (
          status: Extract<LinkMessage, { type: 'queuedStatus' }>['status'],
          text: string,
          resultFailed?: boolean,
        ) => void,
      ) => Promise<void>)
    | null = null;
  replayScope(): string {
    const identity = this.deps.getIdentity();
    return JSON.stringify([
      normalizeGatewayUrl(this.deps.getGatewayUrl()),
      identity.world.id,
      identity.user.id,
      this.agentId,
    ]);
  }

  constructor(private readonly deps: LinkClientDeps) {}

  /**
   * True only while connected and the last `welcome` said `admin: true`. The gateway sets it from
   * the operator-set flag on this pairing; nothing in this module can raise it.
   */
  get isAdmin(): boolean {
    return this.admin && this._state.kind === 'connected';
  }

  /** True when the last `welcome` said `admin: true`, even if the link has since dropped. Not an authorisation. */
  get wasAdmin(): boolean {
    return this.everAdmin;
  }

  /** True while connected and the last `welcome` said `headless: true` (the gateway's own classification). */
  get headlessByGateway(): boolean {
    return this.welcomeHeadless && this._state.kind === 'connected';
  }

  /** The owner the gateway named in the last `welcome`; meaningful only with `headlessByGateway`. */
  get headlessOwnerUserId(): string | null {
    return this.headlessByGateway ? this.welcomeOwner : null;
  }

  /** Vouch for the author Foundry recorded on a challenge message. Sent only by an admin link. */
  attest(nonce: string, authorId: string, authorIsGM: boolean): boolean {
    if (!this.isAdmin || !this.socket) return false;
    this.send({ type: 'attest', nonce, authorId, authorIsGM });
    return true;
  }

  get state(): LinkState {
    return this._state;
  }

  /** True while the link is trying to stay connected (false once stopped or replaced). */
  get isActive(): boolean {
    return this.active;
  }

  onState(fn: (s: LinkState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * The stored token, only if it was issued by the given gateway URL. A malformed
   * stored value counts as no token.
   */
  private tokenForUrl(url: string): string | null {
    return this.ownTokenForUrl(url)?.token ?? null;
  }

  private ownTokenForUrl(url: string): { token: string; source: 'keyed' } | null {
    const cred = this.readCredential();
    if (cred && normalizeGatewayUrl(cred.url) === normalizeGatewayUrl(url)) {
      return { token: cred.token, source: 'keyed' };
    }
    return null;
  }

  /**
   * The token to present: this user's own, else the old shared credential (migration) if it was
   * issued by this gateway.
   */
  private tokenFor(url: string): { token: string; source: 'keyed' | 'legacy' } | null {
    const own = this.ownTokenForUrl(url);
    if (own !== null) return own;
    const legacy = this.parseCredential(this.deps.getLegacyToken?.());
    if (legacy && normalizeGatewayUrl(legacy.url) === normalizeGatewayUrl(url)) {
      return { token: legacy.token, source: 'legacy' };
    }
    return null;
  }

  private readCredential(): TokenCredential | null {
    return this.parseCredential(this.deps.getToken());
  }

  private parseCredential(raw: unknown): TokenCredential | null {
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        return null;
      }
    }
    if (raw && typeof raw === 'object') {
      const { url, token } = raw as Partial<TokenCredential>;
      if (typeof url === 'string' && url && typeof token === 'string' && token) {
        return { url, token };
      }
    }
    return null;
  }

  /** True if the current user has a token stored for any gateway. */
  hasStoredToken(): boolean {
    return this.deps.hasUserToken ? this.deps.hasUserToken() : this.readCredential() !== null;
  }

  /** True if the current user has a stored token issued by the current gateway; what Unpair removes. */
  hasCurrentGatewayToken(): boolean {
    return this.tokenForUrl(this.deps.getGatewayUrl()) !== null;
  }

  /**
   * Connect with the stored token, but only to the gateway that issued it. No stored token:
   * no-op. Token issued elsewhere: nothing is sent and a pairing code is requested.
   */
  start(): void {
    if (
      !this.hasStoredToken() &&
      this.parseCredential(this.deps.getLegacyToken?.()) === null &&
      this.tokenForUrl(this.deps.getGatewayUrl()) === null
    ) {
      // Someone else's pairing in this browser is not this user's: say so, and send nothing.
      if (this.deps.hasOtherTokens?.()) this.requirePairing();
      return;
    }
    if (this.tokenFor(this.deps.getGatewayUrl()) === null) {
      this.requirePairing();
      return;
    }
    this.clearCode();
    this.begin();
  }

  private clearCode(): void {
    this.code = null;
    this.codeUrl = null;
  }

  private requirePairing(): void {
    this.resumeMode = null;
    this.active = false;
    this.codeRejected = false;
    this.clearCode();
    this.cancelTimer();
    this.detach();
    this.setState({ kind: 'disconnected', reason: 'PAIRING_REQUIRED' });
  }

  /** Pair with a code printed by the gateway. */
  pair(code: string): void {
    this.code = code;
    this.codeUrl = normalizeGatewayUrl(this.deps.getGatewayUrl());
    this.codeRejected = false;
    this.begin();
  }

  /**
   * Restart whatever was live when stop() ran. A code pairing resumes with the same code, but only
   * against the URL it was entered for; otherwise pairing is required and nothing is sent.
   */
  resume(): void {
    const mode = this.resumeMode;
    if (mode === 'token') {
      this.start();
    } else if (mode === 'code') {
      if (this.code !== null && this.codeUrl === normalizeGatewayUrl(this.deps.getGatewayUrl())) {
        this.codeRejected = false;
        this.begin();
      } else {
        this.requirePairing();
      }
    }
  }

  /** Forget this browser's pairing for the current user only, and stop the link. */
  async unpair(): Promise<void> {
    const id = this.deps.getIdentity();
    this.requirePairing();
    this.everAdmin = false;
    await this.deps.setToken(null, { worldId: id.world.id, userId: id.user.id });
  }

  stop(): void {
    if (this.active) this.resumeMode = this.code !== null ? 'code' : 'token';
    this.active = false;
    this.codeRejected = false;
    this.cancelTimer();
    this.detach();
    this.setState({ kind: 'disconnected' });
  }

  private begin(): void {
    this.resumeMode = null;
    this.cancelTimer();
    this.detach();
    this.active = true;
    this.attempt = 0;
    this.connect();
  }

  private connect(): void {
    const url = this.deps.getGatewayUrl();
    if (this.code !== null && this.codeUrl !== normalizeGatewayUrl(url)) {
      // Gateway URL changed since the code was entered (e.g. during backoff): never send it there.
      this.requirePairing();
      return;
    }
    if (this.code === null && this.tokenFor(url) === null) {
      // Gateway URL changed since the token was issued (e.g. during backoff).
      this.requirePairing();
      return;
    }
    this.setState(
      this.codeRejected ? { kind: 'connecting', codeRejected: true } : { kind: 'connecting' },
    );
    let ws: SocketLike;
    try {
      ws = this.deps.createSocket(url);
    } catch {
      this.scheduleRetry('ERROR');
      return;
    }
    this.socket = ws;
    ws.onopen = () => {
      let auth: HelloMessage['auth'];
      if (this.code !== null) {
        auth = { kind: 'pairingCode', code: this.code };
        this.authSource = 'code';
      } else {
        const found = this.tokenFor(url);
        if (found === null) {
          this.requirePairing();
          return;
        }
        auth = { kind: 'pairingToken', token: found.token };
        this.authSource = found.source;
      }
      const identity = this.deps.getIdentity();
      this.helloOwner = { url, worldId: identity.world.id, userId: identity.user.id };
      const prior = this.eventResume;
      const resume =
        prior &&
        prior.url === url &&
        prior.worldId === identity.world.id &&
        prior.userId === identity.user.id &&
        auth.kind === 'pairingToken' &&
        prior.token === auth.token
          ? { connectionId: prior.connectionId, lastSeq: prior.lastSeq }
          : undefined;
      this.send({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        ...identity,
        ...(resume ? { resume } : {}),
        auth,
      });
    };
    ws.onmessage = (ev) => {
      if (this.socket !== ws) return;
      void this.handle(ws, ev.data, url);
    };
    ws.onerror = () => {};
    ws.onclose = (ev) => {
      if (this.socket !== ws) return;
      this.socket = null;
      const close = ev as { code?: number; reason?: string } | undefined;
      if (close?.code === REPLACED_CLOSE_CODE && close.reason === REPLACED_CLOSE_REASON) {
        // Another tab took over the link; retrying would just evict it in turn.
        this.active = false;
        this.cancelTimer();
        this.resumeMode = null;
        this.setState({ kind: 'disconnected', reason: 'REPLACED' });
        return;
      }
      if (!this.active) return;
      if (close?.code === 1008 && close.reason === 'PAIRING_INVALID') {
        // A revocation can close the socket without the reject message arriving first.
        void this.pairingInvalid();
        return;
      }
      this.scheduleRetry('ERROR');
    };
  }

  private async handle(origin: SocketLike, raw: unknown, url: string): Promise<void> {
    if (typeof raw !== 'string') return;
    const parsed = parseLinkMessage(raw);
    if (!parsed.ok) return;
    const msg = parsed.message;
    switch (msg.type) {
      case 'welcome': {
        if (msg.pairingToken) {
          const stored = await this.deps.setToken(
            { url, token: msg.pairingToken },
            this.helloOwner ?? undefined,
          );
          if (stored === false) {
            // Storage is full: stay connected on this socket, keep no token, warn once. A later
            // rejection of this socket's credential must not clear anything persisted.
            this.authSource = 'unstored';
            if (!this.storageWarned) {
              this.storageWarned = true;
              this.deps.notifyWarn?.('AGENT_GATEWAY.Link.storageFull');
            }
          } else {
            this.authSource = 'keyed';
          }
          if (this.socket !== origin) {
            // stop() or a restart ran during the write. The token is legitimately issued and now stored,
            // but this socket is gone: do not report connected.
            if (
              !this.active &&
              this.resumeMode === 'code' &&
              this.codeUrl === normalizeGatewayUrl(url)
            ) {
              this.clearCode();
              this.resumeMode = 'token';
            }
            return;
          }
        }
        if (!msg.pairingToken && this.authSource === 'legacy') {
          // The old shared credential was accepted for this user: it becomes theirs alone.
          const legacy = this.parseCredential(this.deps.getLegacyToken?.());
          // Clear the legacy copy only after the keyed write is confirmed persisted (`false` = not).
          const saved = legacy
            ? (await this.deps.setToken(legacy, this.helloOwner ?? undefined)) !== false
            : true;
          if (saved) await this.deps.clearLegacyToken?.();
          if (this.socket !== origin) return;
          // The credential now lives in the keyed entry, so a later revocation must clear that.
          if (saved) this.authSource = 'keyed';
        } else if (!msg.pairingToken && this.authSource === 'keyed') {
          this.deps.touchToken?.(this.helloOwner ?? undefined);
        }
        this.clearCode();
        this.codeRejected = false;
        this.attempt = 0;
        this.agentId = msg.agentId;
        this.admin = msg.admin === true;
        this.everAdmin = this.admin;
        this.welcomeHeadless = msg.headless === true;
        this.welcomeOwner = msg.headless === true ? (msg.ownerUserId ?? null) : null;
        this.gatewayVersion = msg.gatewayVersion;
        const id = this.deps.getIdentity();
        const token = this.authSource === 'unstored' ? undefined : this.tokenFor(url)?.token;
        this.eventResume = token
          ? {
              url,
              worldId: id.world.id,
              userId: id.user.id,
              token,
              connectionId: msg.connectionId,
              lastSeq: 0,
            }
          : undefined;
        this.setState({ kind: 'connected', user: id.user.name, world: id.world.title });
        break;
      }
      case 'pairingChallenge': {
        // Only an invite redemption can be challenged, and only on the socket in use.
        if (this.socket !== origin || this.authSource !== 'code') break;
        this.setState({ kind: 'awaiting-gm' });
        const posted = this.deps.postVouch;
        if (!posted) break;
        // The nonce goes to the hook only; nothing here logs or shows it.
        void Promise.resolve()
          .then(() => posted(msg.nonce))
          .then((ok) => {
            if (ok === false) this.deps.notifyWarn?.('AGENT_GATEWAY.Pairing.Vouch.noGm');
          })
          .catch(() => this.deps.notifyWarn?.('AGENT_GATEWAY.Pairing.Vouch.failed'));
        break;
      }
      case 'purgeEventsResult': {
        const pending = this.purges.get(msg.requestId);
        if (
          this.socket !== origin ||
          !pending ||
          pending.socket !== origin ||
          this._state.kind !== 'connected'
        )
          break;
        clearTimeout(pending.timer);
        this.purges.delete(msg.requestId);
        pending.resolve(msg.count);
        break;
      }
      case 'grants': {
        const pending = this.grantRequests.get(msg.requestId);
        if (this.socket !== origin || !pending || pending.socket !== origin) break;
        clearTimeout(pending.timer);
        this.grantRequests.delete(msg.requestId);
        pending.resolve(msg.grants);
        break;
      }
      case 'invites':
      case 'inviteCreated':
      case 'pairings':
      case 'userGrants': {
        const pending = this.manageRequests.get(msg.requestId);
        if (this.socket !== origin || !pending || pending.socket !== origin) break;
        clearTimeout(pending.timer);
        this.manageRequests.delete(msg.requestId);
        if (
          pending.expect === msg.type &&
          (msg.type !== 'userGrants' || msg.userId === pending.forUser)
        )
          pending.resolve(msg);
        else pending.reject(new ManageError('INTERNAL', 'Unexpected reply'));
        break;
      }
      case 'error': {
        // Only a refused management request carries a request id.
        const pending = msg.requestId ? this.manageRequests.get(msg.requestId) : undefined;
        if (this.socket !== origin || !pending || pending.socket !== origin) break;
        clearTimeout(pending.timer);
        this.manageRequests.delete(msg.requestId as string);
        pending.reject(new ManageError(msg.code, msg.message));
        break;
      }
      case 'consentCode':
        if (this.socket !== origin || this._state.kind !== 'connected') break;
        for (const fn of this.consentListeners) fn(msg);
        break;
      case 'reject':
        this.active = false;
        this.resumeMode = null;
        this.cancelTimer();
        this.detach();
        if (msg.code === 'PAIRING_INVALID') {
          await this.pairingInvalid();
          break;
        } else if (msg.code === 'PROTOCOL_MAJOR_MISMATCH') {
          this.deps.notifyError(msg.message);
        } else if (msg.code === 'PAIRING_UNCONFIRMED') {
          // No admin GM vouched. The invite is still unused on the gateway and any stored token is
          // untouched; only the in-memory code is dropped.
          this.clearCode();
          this.codeRejected = false;
        }
        this.setState({ kind: 'disconnected', reason: msg.code });
        break;
      case 'ping':
        this.send({ type: 'pong' });
        break;
      case 'queuedCalls': {
        const agentId = this.agentId;
        const scope = this.replayScope();
        const current = () =>
          this.socket === origin &&
          this._state.kind === 'connected' &&
          this.agentId === agentId &&
          this.replayScope() === scope &&
          (origin.readyState === undefined || origin.readyState === 1);
        for (const call of msg.calls) {
          const report = (
            status: Extract<LinkMessage, { type: 'queuedStatus' }>['status'],
            text: string,
            resultFailed?: boolean,
          ) => {
            if (current())
              origin.send(
                JSON.stringify({
                  type: 'queuedStatus',
                  id: call.id,
                  status,
                  text: text.slice(0, 4000),
                  ...(resultFailed !== undefined ? { resultFailed } : {}),
                }),
              );
          };
          if (!this.onQueued) {
            report('denied', 'Replay bridge unavailable');
            continue;
          }
          void this.onQueued(call, current, report).catch(() =>
            report('unknown', 'Replay outcome uncertain; reconciliation required'),
          );
        }
        break;
      }
      case 'call':
        await this.dispatch(origin, msg);
        break;
      default:
        break;
    }
  }

  private async dispatch(origin: SocketLike, call: CallMessage): Promise<void> {
    // Replies go only to the socket that received the call, and only while it is still current.
    const reply = (msg: LinkMessage): void => {
      if (this.socket !== origin) return;
      if (origin.readyState !== undefined && origin.readyState !== 1) return;
      origin.send(JSON.stringify(msg));
    };
    if (!this.onCall) {
      reply({
        type: 'error',
        id: call.id,
        code: 'TOOL_NOT_FOUND',
        message: `No handler installed for tool ${call.tool}`,
      });
      return;
    }
    try {
      const res = await this.onCall(call);
      if (res.ok) {
        const frame: LinkMessage = {
          type: 'result',
          id: call.id,
          ok: true,
          text: res.text,
          ...(res.structured !== undefined ? { structured: res.structured } : {}),
          ...(res.images && res.images.length > 0 ? { images: res.images } : {}),
        };
        const bytes = new TextEncoder().encode(JSON.stringify(frame)).length;
        // An oversize frame would close the whole link, so refuse this one call instead.
        if (frame.type === 'result' && frame.images && bytes > MAX_FRAME_BYTES) {
          reply({
            type: 'error',
            id: call.id,
            code: 'INVALID_ARGS',
            message: `Result frame is ${bytes} bytes, over the ${MAX_FRAME_BYTES}-byte limit`,
          });
        } else reply(frame);
      } else {
        reply({ type: 'error', id: call.id, code: res.code, message: res.message });
      }
    } catch (e) {
      reply({
        type: 'error',
        id: call.id,
        code: 'INTERNAL',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** The gateway refused this link's credential. Stops retrying; never invents a new credential. */
  private async pairingInvalid(): Promise<void> {
    this.active = false;
    this.resumeMode = null;
    this.cancelTimer();
    this.detach();
    // Only a rejected token is stale; a rejected code leaves a working token alone.
    const usedToken = this.code === null;
    this.clearCode();
    if (usedToken) {
      this.everAdmin = false;
      // Only the credential that was sent is stale: the old shared one, or this user's own.
      if (this.authSource === 'legacy') await this.deps.clearLegacyToken?.();
      else if (this.authSource === 'keyed')
        await this.deps.setToken(null, this.helloOwner ?? undefined);
      // 'unstored': nothing was persisted for this socket's credential, so there is nothing to clear.
      this.setState({ kind: 'disconnected', reason: 'TOKEN_REJECTED' });
      return;
    }
    if (this.tokenFor(this.deps.getGatewayUrl()) !== null) {
      // Rejected code: fall back to the token, which is only held for this same gateway.
      this.codeRejected = true;
      this.start();
      return;
    }
    this.setState({ kind: 'disconnected', reason: 'PAIRING_INVALID' });
  }

  /**
   * Reconnect now if a retry is waiting (the network or the tab came back). Keeps the backoff
   * attempt count; does nothing in any other state.
   */
  retryNow(): void {
    if (!this.active || this.timer === null) return;
    this.cancelTimer();
    this.connect();
  }

  private scheduleRetry(reason: 'ERROR'): void {
    this.detach();
    this.setState({ kind: 'disconnected', reason });
    const delay = backoffDelay(this.attempt, (this.deps.random ?? Math.random)());
    this.attempt += 1;
    const set = this.deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.timer = set(() => {
      this.timer = null;
      if (this.active) this.connect();
    }, delay);
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    (this.deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
  }

  private detach(): void {
    const ws = this.socket;
    this.socket = null;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }

  /** Send a frame on the live socket, if there is one. Used for `toolset`, after `welcome`. */
  sendMessage(msg: LinkMessage): void {
    // Native WebSocket.send silently discards while closing; do not claim it was sent.
    if (
      msg.type === 'event' &&
      (!this.socket || (this.socket.readyState !== undefined && this.socket.readyState !== 1))
    )
      return;
    this.send(msg);
    if (
      msg.type === 'event' &&
      this.socket &&
      this._state.kind === 'connected' &&
      this.eventResume
    ) {
      const identity = this.deps.getIdentity();
      if (
        identity.world.id === this.eventResume.worldId &&
        identity.user.id === this.eventResume.userId &&
        msg.event.userId === identity.user.id
      )
        this.eventResume.lastSeq = Math.max(this.eventResume.lastSeq, msg.event.seq);
    }
  }

  private send(msg: LinkMessage): void {
    this.socket?.send(JSON.stringify(msg));
  }

  private setState(s: LinkState): void {
    this._state = s;
    if (s.kind !== 'connected') {
      this.admin = false;
      this.welcomeHeadless = false;
      this.welcomeOwner = null;
      this.gatewayVersion = null;
      for (const [id, p] of this.grantRequests) {
        clearTimeout(p.timer);
        this.grantRequests.delete(id);
        p.reject(new Error('Gateway disconnected'));
      }
    }
    if (s.kind !== 'connected')
      for (const [id, p] of this.manageRequests) {
        clearTimeout(p.timer);
        this.manageRequests.delete(id);
        p.reject(new ManageError('OFFLINE', 'Gateway disconnected'));
      }
    if (s.kind !== 'connected')
      for (const [id, p] of this.purges) {
        clearTimeout(p.timer);
        this.purges.delete(id);
        p.reject(new Error('Gateway disconnected'));
      }
    for (const fn of this.listeners) fn(s);
  }
}
