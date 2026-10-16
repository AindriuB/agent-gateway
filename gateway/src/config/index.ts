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
  /** `--privacy-url`: the operator's privacy notice, linked from the consent pages; '' when unset. */
  privacyUrl: z.string().default(''),
  /** `--source-url`: where the running source lives, linked from the consent pages; '' when unset. */
  sourceUrl: z.string().default(''),
  /** Always-on, many users: no stdio session, and stdin ending does not stop the process. */
  serverMode: boolish.default(false),
  linkHost: z.string().min(1).default('127.0.0.1'),
  httpHost: z.string().min(1).default('127.0.0.1'),
  /** Key clients by the right-most `X-Forwarded-For` entry when the peer is loopback. */
  trustProxy: boolish.default(false),
  /** The single headless agent (task 37; 38 generalizes it). All four are set, or none. */
  headlessFoundryUrl: z.string().default(''),
  headlessWorld: z.string().default(''),
  /** A Foundry user id, not a name. */
  headlessUser: z.string().default(''),
  /** Only from the environment or the 0600 config file; never a flag. */
  headlessPassword: z.string().default(''),
  /**
   * Run the headless Chromium with `--no-sandbox`. Off by default; the Docker image turns it on,
   * because Chromium's sandbox cannot start as a non-root user without extra capabilities.
   */
  headlessNoSandbox: boolish.default(false),
  /**
   * Passwords of the stored headless agents (task 38), by agent name. From
   * `AGENT_GATEWAY_HEADLESS_<NAME>_PASSWORD` or `headless.<name>.password` in the 0600 config file;
   * never a flag. An agent without an entry is not started. Never an empty string.
   */
  headlessAgentPasswords: z.record(z.string(), z.string()).default({}),
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
  AGENT_GATEWAY_PRIVACY_URL: 'privacyUrl',
  AGENT_GATEWAY_SOURCE_URL: 'sourceUrl',
  AGENT_GATEWAY_SERVER_MODE: 'serverMode',
  AGENT_GATEWAY_LINK_HOST: 'linkHost',
  AGENT_GATEWAY_HTTP_HOST: 'httpHost',
  AGENT_GATEWAY_TRUST_PROXY: 'trustProxy',
  AGENT_GATEWAY_HEADLESS_FOUNDRY_URL: 'headlessFoundryUrl',
  AGENT_GATEWAY_HEADLESS_WORLD: 'headlessWorld',
  AGENT_GATEWAY_HEADLESS_USER: 'headlessUser',
  AGENT_GATEWAY_HEADLESS_PASSWORD: 'headlessPassword',
  AGENT_GATEWAY_HEADLESS_NO_SANDBOX: 'headlessNoSandbox',
};

const AGENT_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
const AGENT_ENV = /^AGENT_GATEWAY_HEADLESS_([A-Z0-9_]+)_PASSWORD$/;

/** The env variable that holds a stored agent's password. */
export const agentPasswordEnv = (name: string): string =>
  `AGENT_GATEWAY_HEADLESS_${name.toUpperCase().replaceAll('-', '_')}_PASSWORD`;

/**
 * The stored agents' passwords: the file's nested `headless.<name>.password`, then env. A key that
 * is present but empty is refused (the agent user needs a Foundry password); messages name the
 * key and never a value.
 */
function agentPasswords(
  file: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const out: Record<string, string> = {};
  const section = file.headless;
  if (section !== undefined) {
    if (typeof section !== 'object' || section === null || Array.isArray(section))
      throw new ConfigError('Config key headless must be an object of agent names');
    for (const [name, entry] of Object.entries(section)) {
      const key = `headless.${name}.password`;
      if (!AGENT_NAME.test(name))
        throw new ConfigError(
          `Config key under headless is not a valid agent name (name not shown, it may carry a secret)`,
        );
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
        throw new ConfigError(`Config key headless.${name} must be an object with a password`);
      const pw = (entry as { password?: unknown }).password;
      if (pw === undefined) continue;
      if (typeof pw !== 'string') throw new ConfigError(`Config key ${key} must be a string`);
      if (pw === '')
        throw new ConfigError(
          `Config key ${key} is empty; the agent user needs a Foundry password`,
        );
      out[name] = pw;
    }
  }
  for (const [envKey, value] of Object.entries(env)) {
    const m = AGENT_ENV.exec(envKey);
    // The flag/env agent's own AGENT_GATEWAY_HEADLESS_PASSWORD has no name part and never matches.
    if (!m || value === undefined) continue;
    const name = m[1]!.toLowerCase().replaceAll('_', '-');
    if (!AGENT_NAME.test(name)) continue;
    if (value === '')
      throw new ConfigError(`${envKey} is set but empty; the agent user needs a Foundry password`);
    out[name] = value;
  }
  return out;
}

/**
 * The public URL as a bare origin: `https:` only (`http:` on a loopback host for local testing),
 * no path, query or fragment; a trailing `/` is dropped. Throws a usage error otherwise.
 */
export function normalizePublicUrl(value: string): string {
  const refuse = (why: string): never => {
    throw new ConfigError(
      `Invalid --public-url (value not shown, it may carry a secret): ${why}`,
      2,
    );
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

/**
 * The Foundry URL of the headless agent: http(s), no credentials, query or fragment. A path
 * (a Foundry route prefix) is kept; a trailing `/` is dropped.
 */
export function normalizeFoundryUrl(value: string): string {
  const refuse = (why: string): never => {
    throw new ConfigError(
      `Invalid --headless-foundry-url (value not shown, it may carry a secret): ${why}`,
      2,
    );
  };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return refuse('not a URL (use e.g. http://foundry.local:30000)');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return refuse('the scheme must be http or https');
  if (url.username || url.password) return refuse('it must not carry credentials');
  if (url.search || url.hash) return refuse('it must not carry a query or fragment');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

const MAX_LINK_URL = 2048;

/**
 * A link target shown on the consent pages: `https:` (`http:` on a loopback host), no credentials,
 * at most 2048 characters. Returns the parsed `href`. Throws a usage error otherwise.
 */
export function normalizeLinkUrl(flag: '--privacy-url' | '--source-url', value: string): string {
  const refuse = (why: string): never => {
    throw new ConfigError(`Invalid ${flag} (value not shown, it may carry a secret): ${why}`, 2);
  };
  if (value.length > MAX_LINK_URL) return refuse(`longer than ${MAX_LINK_URL} characters`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return refuse('not a URL (use e.g. https://example.org/privacy)');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return refuse('the scheme must be https');
  const bare = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol === 'http:' && !isLoopbackAddress(bare) && bare !== 'localhost')
    return refuse('http is allowed only on a loopback host; use https');
  if (url.username || url.password) return refuse('it must not carry credentials');
  if (url.href.length > MAX_LINK_URL)
    return refuse(`longer than ${MAX_LINK_URL} characters once encoded`);
  return url.href;
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
    // Never the parser's message: Node quotes a snippet of the file, which may hold a password.
    if (err instanceof SyntaxError) throw new ConfigError(`Config file ${path} is not valid JSON`);
    throw new ConfigError(`Cannot read config file ${path}: ${(err as Error).message}`);
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
  merged.headlessAgentPasswords = agentPasswords(merged, env);
  delete merged.headless;
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new ConfigError(`Invalid configuration: ${z.prettifyError(result.error)}`);
  }
  const config = result.data;
  if (config.publicUrl !== '') config.publicUrl = normalizePublicUrl(config.publicUrl);
  if (config.privacyUrl !== '')
    config.privacyUrl = normalizeLinkUrl('--privacy-url', config.privacyUrl);
  if (config.sourceUrl !== '')
    config.sourceUrl = normalizeLinkUrl('--source-url', config.sourceUrl);
  const headless = [
    config.headlessFoundryUrl,
    config.headlessWorld,
    config.headlessUser,
    config.headlessPassword,
  ];
  if (headless.some((v) => v !== '')) {
    if (headless.some((v) => v === ''))
      throw new ConfigError(
        'The headless agent needs --headless-foundry-url, --headless-world, --headless-user and AGENT_GATEWAY_HEADLESS_PASSWORD (or headlessPassword in the 0600 --config file) together',
        2,
      );
    config.headlessFoundryUrl = normalizeFoundryUrl(config.headlessFoundryUrl);
  }
  // Exposing a listener beyond loopback is allowed only behind a public URL (and a reverse proxy).
  for (const [flag, host] of [
    ['--link-host', config.linkHost],
    ['--http-host', config.httpHost],
  ] as const) {
    if (config.publicUrl === '' && !isLoopbackAddress(host))
      throw new ConfigError(
        `Refusing ${flag} (value not shown, it may carry a secret): a non-loopback address needs --public-url (TLS is terminated by a reverse proxy in front of the gateway)`,
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
/** Public mode: 16 principals at full quota (MAX_HTTP_SESSIONS_PER_PRINCIPAL). */
export const MAX_HTTP_SESSIONS_PUBLIC = 256;
/** Public clients rarely send DELETE, so an abandoned session is swept sooner. */
export const PUBLIC_HTTP_SESSION_IDLE_MS = 10 * 60_000;
/** The only address the local HTTP transport may bind in this release. */
export const HTTP_BIND_HOST = '127.0.0.1';
