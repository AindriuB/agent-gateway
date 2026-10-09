import { statSync, readFileSync } from 'node:fs';
import { z } from 'zod';

export const ConfigSchema = z.object({
  linkPort: z.coerce.number().int().min(1).max(65535).default(7420),
  httpPort: z.coerce.number().int().min(1).max(65535).default(7421),
  role: z.enum(['player', 'gm']).default('player'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;

export class ConfigError extends Error {}

const ENV_KEYS: Record<string, keyof Config> = {
  AGENT_GATEWAY_LINK_PORT: 'linkPort',
  AGENT_GATEWAY_HTTP_PORT: 'httpPort',
  AGENT_GATEWAY_ROLE: 'role',
  AGENT_GATEWAY_LOG_LEVEL: 'logLevel',
};

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
}

/** Precedence: file, then env, then flags (later wins). */
export function loadConfig(input: LoadConfigInput = {}): Config {
  const env = input.env ?? process.env;
  const merged: Record<string, unknown> = {};
  if (input.configPath) Object.assign(merged, readConfigFile(input.configPath));
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
  return result.data;
}
