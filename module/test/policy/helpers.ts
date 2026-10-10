/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lang = JSON.parse(readFileSync(resolve(__dirname, '../../../lang/en.json'), 'utf8'));
const lookup = (key: string): string | undefined =>
  key.split('.').reduce((o: any, k) => o?.[k], lang) as string | undefined;

/** A `game.i18n` that resolves from lang/en.json like Foundry would for an English user. */
export const englishI18n = {
  localize: (key: string) => lookup(key) ?? key,
  format: (key: string, data: Record<string, string> = {}) =>
    (lookup(key) ?? key).replace(/\{(\w+)\}/g, (_m, k: string) => data[k] ?? `{${k}}`),
};

/** Set world/client settings through the stub's `game.settings.set`. */
export async function setSetting(key: string, value: unknown): Promise<void> {
  await (globalThis as any).game.settings.set('agent-gateway', key, value);
}
