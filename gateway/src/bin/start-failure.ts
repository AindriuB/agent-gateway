import { LinkListenError } from '../link/server.js';

export interface StartFailureIo {
  writeStderr(line: string): void;
  exit(code: number): never | void;
}

/** Report a failed start as one plain stderr line; stdout is the MCP channel. */
export function reportStartFailure(err: unknown, io: StartFailureIo): void {
  if (err instanceof LinkListenError) io.writeStderr(`${err.message}\n`);
  else io.writeStderr(`Failed to start: ${String(err)}\n`);
  io.exit(1);
}
