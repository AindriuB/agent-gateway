/** Relay wire version, sent as `relay` in every handshake line. */
export const RELAY_VERSION = 1;
/** The primary must receive a secondary's handshake line within this long. */
export const RELAY_HANDSHAKE_MS = 2000;
/** Longest single line (one JSON-RPC message) either end accepts. */
export const MAX_RELAY_LINE_BYTES = 4 * 1024 * 1024;
/** Concurrent authenticated relay connections the primary serves. */
export const MAX_RELAY_SESSIONS = 16;
/** Unflushed bytes allowed on one relay socket before it is destroyed. */
export const MAX_RELAY_BUFFERED_BYTES = 8 * 1024 * 1024;
/** Longest string request id a secondary tracks; longer ones are rejected. */
export const MAX_RELAY_ID_CHARS = 200;
/** In-flight request ids a secondary tracks before answering RELAY_BUSY. */
export const MAX_RELAY_PENDING = 256;
/** Connect or takeover attempts before a secondary gives up and serves the degraded server. */
export const RELAY_CONNECT_ATTEMPTS = 10;
export const RELAY_BACKOFF_START_MS = 100;
export const RELAY_BACKOFF_CAP_MS = 2000;
/** Longest first line the primary reads before it decides the handshake is malformed. */
export const MAX_RELAY_HANDSHAKE_BYTES = 4096;
/** `sun_path` limit on darwin, minus the terminating NUL. */
export const MAX_UNIX_SOCKET_PATH_BYTES = 103;

/** How long an instance keeps waiting for older primaries to hand it the link before it gives up. */
export const RELAY_TAKEOVER_DEADLINE_MS = 60_000;
/** A handover claim older than the grace period plus this is stale and ignored. */
export const RELAY_CLAIM_SLACK_MS = 10_000;

/** How long a primary keeps serving after agreeing to step down for a newer config. */
export const STEPDOWN_GRACE_MS = 2000;

/** JSON-RPC error code used for every relay-originated error. */
export const RELAY_RPC_ERROR = -32001;
export const RELAY_LOST = 'RELAY_LOST';
export const RELAY_BUSY = 'RELAY_BUSY';
export const RELAY_RECONNECTING = 'RELAY_RECONNECTING';

export type RelayRefusal =
  | 'RELAY_AUTH'
  | 'RELAY_PORT_MISMATCH'
  | 'RELAY_SELECTOR_MISMATCH'
  | 'RELAY_FULL'
  | 'RELAY_PROTOCOL'
  /** The secondary's config differs and is not newer: it must not relay. */
  | 'RELAY_CONFIG_MISMATCH'
  /** The secondary's config differs and is newer: the primary is stepping down for it. */
  | 'RELAY_CONFIG_STEPDOWN';
