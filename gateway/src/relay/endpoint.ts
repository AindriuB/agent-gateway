import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { MAX_UNIX_SOCKET_PATH_BYTES } from './constants.js';

export type RelayEndpoint = { ok: true; path: string } | { ok: false; reason: string };

export const PIPE_PREFIX = '\\\\.\\pipe\\foundry-agent-gateway-';
export const SOCKET_FILE = 'relay.sock';
export const SECRET_FILE = 'relay.secret';

/**
 * Where the primary's relay listens, derived from the state dir so that every instance sharing a
 * db finds the same endpoint. A Unix socket on darwin/linux, a named pipe on win32.
 */
export function relayEndpoint(
  stateDir: string,
  platform: NodeJS.Platform = process.platform,
): RelayEndpoint {
  if (platform === 'win32') {
    // Pipe squatting: the name above is predictable, and another local user can create a pipe
    // with it first and receive the secret. Node cannot set a pipe DACL, so on win32 the primary
    // appends a random per-boot suffix (see RelayServer.listen) and publishes the full name in
    // the secret file, which only this user can read. This base name is only the fallback.
    const digest = createHash('sha256')
      .update(win32.resolve(stateDir).toLowerCase())
      .digest('hex')
      .slice(0, 16);
    return { ok: true, path: `${PIPE_PREFIX}${digest}` };
  }
  const path = posix.join(posix.resolve(stateDir), SOCKET_FILE);
  const bytes = Buffer.byteLength(path);
  if (bytes > MAX_UNIX_SOCKET_PATH_BYTES)
    return {
      ok: false,
      reason: `the relay socket path is ${bytes} bytes, over the ${MAX_UNIX_SOCKET_PATH_BYTES}-byte limit; use a shorter --db path`,
    };
  return { ok: true, path };
}
