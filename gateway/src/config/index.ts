import { statSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { isLoopbackAddress } from '../http/client-key.js';

/** '1'/'true'/'yes'/'on' and their opposites, as an env var or config file may spell them. */
const boolish = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const t = v.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(t)) return true;
  if (['0', 'false', 'no', 'off', ''].includes(t)) return false;
  return v;
}, z.boolean());

/** A comma-separated string (the env form) or a list; blanks are dropped. */
const stringList = z.preprocess(
  (v) =>
    typeof v === 'string'
      ? v.split(',')
      : Array.isArray(v)
        ? v.flatMap((x) => (typeof x === 'string' ? x.split(',') : [x]))
        : v,
  z.array(z.string().transform((x) => x.trim())).transform((l) => l.filter((x) => x !== '')),
);

export const ConfigSchema = z.object({
  linkPort: z.coerce.number().int().min(1).max(65535).default(7420),
  httpPort: z.coerce.number().int().min(1).max(65535).default(7421),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** Serve MCP over Streamable HTTP. Also on whenever `publicUrl` or `serverMode` is set. */
  http: boolish.default(false),
  /** `--allow-origin`: only these browser origins may reach the link. Empty means any. */
  allowOrigin: stringList.default([]),
  /** The external origin behind a reverse proxy, normalized; '' when unset. */
  publicUrl: z.string().default(''),
  /** Always-on, many users: no stdio session, and stdin ending does not stop the process. */
  serverMode: boolish.default(false),
  linkHost: z.string().min(1).default('127.0.0.1'),
  httpHost: z.string().min(1).default('127.0.0.1'),
  /** Key clients by the right-most `X-Forwarded-For` entry when the peer is loopback. */
  trustProxy: boolish.default(false),
});

export type Config = z.infer<typeof ConfigSchema>;

export class ConfigError extends Error {
  /** 2 for a refused setting (usage), 1 for a file or value that could not be read. */
  constructor(
    message: string,
    readonly exitCode: 1 | 2 = 1,
  ) {
    super(message);
  }
}

const ENV_KEYS: Record<string, keyof Config> = {
  AGENT_GATEWAY_LINK_PORT: 'linkPort',
  AGENT_GATEWAY_HTTP_PORT: 'httpPort',
  AGENT_GATEWAY_LOG_LEVEL: 'logLevel',
  AGENT_GATEWAY_HTTP: 'http',
  AGENT_GATEWAY_ALLOW_ORIGIN: 'allowOrigin',
  AGENT_GATEWAY_PUBLIC_URL: 'publicUrl',
  AGENT_GATEWAY_SERVER_MODE: 'serverMode',
  AGENT_GATEWAY_LINK_HOST: 'linkHost',
  AGENT_GATEWAY_HTTP_HOST: 'httpHost',
  AGENT_GATEWAY_TRUST_PROXY: 'trustProxy',
};

/**
 * The public URL as a bare origin: `https:` only (`http:` on a loopback host for local testing),
 * no path, query or fragment; a trailing `/` is dropped. Throws a usage error otherwise.
 */
export function normalizePublicUrl(value: string): string {
  const refuse = (why: string): never => {
    throw new ConfigError(`Invalid --public-url ${value}: ${why}`, 2);
  };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return refuse('not a URL (use e.g. https://gw.example.com)');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return refuse('the scheme must be https');
  const bare = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol === 'http:' && !isLoopbackAddress(bare) && bare !== 'localhost')
    return refuse('http is allowed only on a loopback host; use https');
  if (url.username || url.password) return refuse('it must not carry credentials');
  if (url.pathname !== '/' || url.search || url.hash)
    return refuse('it must be an origin only: no path, query or fragment');
  return url.origin;
}

export function readConfigFile(path: string): Record<string, unknown> {
  let mode: number;
  try {
    mode = statSync(path).mode;
  } catch (err) {
    throw new ConfigError(`Cannot read config file ${path}: ${(err as Error).message}`);
  }
  if (process.platform !== 'win32' && (mode & 0o077) !== 0) {
    throw new ConfigError(
      `Config file ${path} is readable by group or other; run: chmod 600 ${path}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new ConfigError(`Config file ${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(`Config file ${path} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export interface LoadConfigInput {
  configPath?: string | undefined;
  env?: NodeJS.ProcessEnv;
  flags?: Partial<Record<keyof Config, unknown>>;
  /** Called once if a retired `role` setting was given. The value is otherwise ignored. */
  onIgnored?: (message: string) => void;
}

export const IGNORED_ROLE_MESSAGE =
  'AGENT_GATEWAY_ROLE / config "role" is ignored: the tool tier comes from the Foundry user\'s role';

/** Precedence: file, then env, then flags (later wins). */
export function loadConfig(input: LoadConfigInput = {}): Config {
  const env = input.env ?? process.env;
  const merged: Record<string, unknown> = {};
  if (input.configPath) Object.assign(merged, readConfigFile(input.configPath));
  // The tool tier comes only from the Foundry user's role, never from a gateway setting.
  const roleGiven = 'role' in merged || (env.AGENT_GATEWAY_ROLE ?? '') !== '';
  delete merged.role;
  if (roleGiven) input.onIgnored?.(IGNORED_ROLE_MESSAGE);
  for (const [envKey, key] of Object.entries(ENV_KEYS)) {
    const v = env[envKey];
    if (v !== undefined && v !== '') merged[key] = v;
  }
  for (const [k, v] of Object.entries(input.flags ?? {})) {
    if (v !== undefined) merged[k] = v;
  }
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new ConfigError(`Invalid configuration: ${z.prettifyError(result.error)}`);
  }
  const config = result.data;
  if (config.publicUrl !== '') config.publicUrl = normalizePublicUrl(config.publicUrl);
  // Exposing a listener beyond loopback is allowed only behind a public URL (and a reverse proxy).
  for (const [flag, host] of [
    ['--link-host', config.linkHost],
    ['--http-host', config.httpHost],
  ] as const) {
    if (config.publicUrl === '' && !isLoopbackAddress(host))
      throw new ConfigError(
        `Refusing ${flag} ${host}: a non-loopback address needs --public-url (TLS is terminated by a reverse proxy in front of the gateway)`,
        2,
      );
  }
  return config;
}

/** Local HTTP transport limits (task 34). */
export const MAX_REQUEST_BYTES = 1_000_000;
/** Requests per second per token before the gateway answers 429; coarse self-protection only. */
export const SELF_PROTECT_RPS = 50;
export const MAX_HTTP_SESSIONS = 16;
export const HTTP_SESSION_IDLE_MS = 30 * 60_000;
/** The only address the local HTTP transport may bind in this release. */
export const HTTP_BIND_HOST = '127.0.0.1';
