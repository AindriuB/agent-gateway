import { existsSync, readFileSync } from 'node:fs';
import { leakMatchers } from '../fixtures/manifest.js';
import { e2ePaths, loadE2eConfig, type E2eConfig, type E2ePaths } from './config.js';
import type { CallResult, GatewayProcess } from './gateway.js';
import { LeakChecker } from './leak.js';
import { readRunData, recordRunData } from './rundata.js';

export interface FixtureState {
  blindRollTotal?: number;
  uuids?: Record<string, string>;
}

export interface Context {
  config: E2eConfig;
  paths: E2ePaths;
  fixtures: FixtureState;
}

export function loadFixtureState(path: string): FixtureState {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as FixtureState;
}

export function loadContext(): Context {
  const paths = e2ePaths();
  const config = loadE2eConfig({
    testEnvText: existsSync(paths.testEnv) ? readFileSync(paths.testEnv, 'utf8') : undefined,
  });
  return { config, paths, fixtures: loadFixtureState(paths.fixtureState) };
}

export function limitedPackUuid(paths: E2ePaths): string | undefined {
  for (const r of readRunData(paths.runData))
    if (r.kind === 'facts' && r.limitedPackUuid) return r.limitedPackUuid;
  return undefined;
}

/** A caller that scans every result for hidden strings before returning it. */
export class PlayerCaller {
  readonly leak: LeakChecker;

  constructor(
    private readonly gateway: GatewayProcess,
    private readonly paths: E2ePaths,
    blindRollTotal?: number,
  ) {
    this.leak = new LeakChecker(leakMatchers(blindRollTotal));
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<CallResult> {
    const res = await this.gateway.call(name, args);
    this.leak.check(name, args, res.raw);
    return res;
  }

  record(): void {
    recordRunData(this.paths.runData, { kind: 'leak', ...this.leak.summary() });
  }
}

/** Follow `nextCursor` and join the markdown of every page. */
export async function readAllPages(
  call: (args: Record<string, unknown>) => Promise<CallResult>,
  field: 'content' | 'markdown',
  maxPages = 30,
): Promise<string> {
  let cursor: string | undefined;
  let out = '';
  for (let i = 0; i < maxPages; i++) {
    const r = await call(cursor ? { cursor } : {});
    if (r.isError) throw new Error(`read failed: ${r.text}`);
    out += String(r.structured?.[field] ?? '');
    cursor = r.structured?.nextCursor as string | undefined;
    if (!cursor) break;
  }
  return out;
}
