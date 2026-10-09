/** Logging goes to stderr only: stdout is the MCP channel. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function createLogger(level: LogLevel = 'info'): Logger {
  const emit = (l: LogLevel) => (msg: string) => {
    if (ORDER[l] >= ORDER[level]) process.stderr.write(`[${l}] ${msg}\n`);
  };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}
