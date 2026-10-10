import { homedir } from 'node:os';
import { join } from 'node:path';

export interface E2eConfig {
  foundryUrl: string;
  /** Origin of `foundryUrl`, passed to the gateway as `--allow-origin`. */
  foundryOrigin: string;
  world: string;
  gmUser: string;
  playerUser: string;
  player2User: string;
  /** Per-user passwords; each applies to its own user only. */
  passwords: { gm: string | undefined; player: string | undefined; player2: string | undefined };
  /** One-line notices for the operator (for example an ignored legacy variable). */
  warnings: string[];
  linkPort: number;
  v13Url: string | undefined;
  /** How long setup waits for a human to type a pairing code. */
  pairTimeoutMs: number;
  /** How long a run waits for a stored pairing to connect before failing. */
  connectTimeoutMs: number;
  headed: boolean;
}

export interface E2ePaths {
  stateDir: string;
  profilesDir: string;
  db: string;
  summary: string;
  /** Facts the seed learned (the blind roll total); read by the leak check. */
  fixtureState: string;
  runData: string;
  testEnv: string;
}

export const DEV_LINK_PORT = 7420;
export const DEFAULT_E2E_PORT = 7429;

export function e2ePaths(home: string = homedir()): E2ePaths {
  const base = join(home, '.config', 'agent-gateway');
  const stateDir = join(base, 'e2e');
  return {
    stateDir,
    profilesDir: join(stateDir, 'profiles'),
    db: join(stateDir, 'gateway.db'),
    summary: join(stateDir, 'e2e-summary.json'),
    fixtureState: join(stateDir, 'fixture-state.json'),
    runData: join(stateDir, 'run-data.jsonl'),
    testEnv: join(base, 'test.env'),
  };
}

export function profileDir(paths: E2ePaths, user: string): string {
  // Names are operator-chosen; keep them from escaping the profiles directory.
  return join(paths.profilesDir, user.replace(/[^A-Za-z0-9._-]/g, '_'));
}

/** Parse `KEY=value` lines. `#` comments, blank lines, an `export ` prefix and quotes are tolerated. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = (m[2] ?? '').trim();
    if (/^(["']).*\1$/.test(value) && value.length >= 2) value = value.slice(1, -1);
    out[m[1] as string] = value;
  }
  return out;
}

export class ConfigError extends Error {}

export interface LoadDeps {
  env?: Record<string, string | undefined>;
  /** Contents of test.env, or undefined when the file does not exist. */
  testEnvText?: string | undefined;
}

export function loadE2eConfig(deps: LoadDeps = {}): E2eConfig {
  const env = deps.env ?? process.env;
  const file = deps.testEnvText !== undefined ? parseEnvFile(deps.testEnvText) : {};
  // The environment wins over the file; empty strings count as unset.
  const get = (key: string): string | undefined => {
    const fromEnv = env[key];
    if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
    const fromFile = file[key];
    return fromFile !== undefined && fromFile !== '' ? fromFile : undefined;
  };
  // A defined environment value wins even when empty (empty means "no password").
  const password = (key: string): string | undefined => {
    const fromEnv = env[key];
    if (fromEnv !== undefined) return fromEnv === '' ? undefined : fromEnv;
    const fromFile = file[key];
    return fromFile !== undefined && fromFile !== '' ? fromFile : undefined;
  };
  const warnings: string[] = [];
  if (env.FOUNDRY_PASSWORD !== undefined || file.FOUNDRY_PASSWORD !== undefined) {
    warnings.push(
      'FOUNDRY_PASSWORD is ignored; use FOUNDRY_GM_PASSWORD, FOUNDRY_PLAYER_PASSWORD and FOUNDRY_PLAYER2_PASSWORD',
    );
  }
  const foundryUrl = (get('FOUNDRY_URL') ?? 'https://foundry.local').replace(/\/+$/, '');
  let foundryOrigin: string;
  try {
    foundryOrigin = new URL(foundryUrl).origin;
  } catch {
    throw new ConfigError(`FOUNDRY_URL is not a URL: ${foundryUrl}`);
  }
  const portText = get('AGENT_GATEWAY_E2E_LINK_PORT');
  const linkPort = portText === undefined ? DEFAULT_E2E_PORT : Number(portText);
  if (!Number.isInteger(linkPort) || linkPort < 1 || linkPort > 65535) {
    throw new ConfigError(`AGENT_GATEWAY_E2E_LINK_PORT is not a port: ${portText}`);
  }
  if (linkPort === DEV_LINK_PORT) {
    throw new ConfigError(
      `AGENT_GATEWAY_E2E_LINK_PORT must not be ${DEV_LINK_PORT}: that is the dev link port`,
    );
  }
  const seconds = (key: string, fallbackSeconds: number): number => {
    const t = get(key);
    if (t === undefined) return fallbackSeconds * 1000;
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0) throw new ConfigError(`${key} must be a positive number`);
    return n * 1000;
  };
  return {
    foundryUrl,
    foundryOrigin,
    world: get('FOUNDRY_WORLD') ?? 'test-world',
    gmUser: get('FOUNDRY_GM_USER') ?? 'dev-gm',
    playerUser: get('FOUNDRY_PLAYER_USER') ?? 'player1',
    player2User: get('FOUNDRY_PLAYER2_USER') ?? 'player2',
    passwords: {
      gm: password('FOUNDRY_GM_PASSWORD'),
      player: password('FOUNDRY_PLAYER_PASSWORD'),
      player2: password('FOUNDRY_PLAYER2_PASSWORD'),
    },
    warnings,
    linkPort,
    v13Url: get('AGENT_GATEWAY_E2E_V13_URL')?.replace(/\/+$/, ''),
    pairTimeoutMs: seconds('AGENT_GATEWAY_E2E_PAIR_TIMEOUT_S', 300),
    connectTimeoutMs: seconds('AGENT_GATEWAY_E2E_CONNECT_TIMEOUT_S', 20),
    headed: get('AGENT_GATEWAY_E2E_HEADED') === '1',
  };
}

/** The password configured for `user`, matched by name (case-insensitively); undefined if none. */
export function passwordFor(config: E2eConfig, user: string): string | undefined {
  const is = (name: string) => name.toLowerCase() === user.toLowerCase();
  if (is(config.gmUser)) return config.passwords.gm;
  if (is(config.playerUser)) return config.passwords.player;
  if (is(config.player2User)) return config.passwords.player2;
  return undefined;
}

export function printWarnings(config: E2eConfig): void {
  for (const w of config.warnings) process.stderr.write(`warning: ${w}\n`);
}

/** The same configuration pointed at another Foundry instance (v13). */
export function withFoundryUrl(config: E2eConfig, url: string): E2eConfig {
  const foundryUrl = url.replace(/\/+$/, '');
  return { ...config, foundryUrl, foundryOrigin: new URL(foundryUrl).origin };
}
