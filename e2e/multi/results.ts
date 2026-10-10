import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Results of the multi-user suites. They are kept in their own file beside the 12a summary
 * (the summary builder cannot take new record kinds) and printed as the suites run.
 */
export interface MultiResult {
  suite: string;
  label: string;
  value: string;
}

export const resultsPath = (stateDir: string): string => join(stateDir, 'e2e-multi-results.jsonl');

export function formatResult(r: MultiResult): string {
  return `[multi] ${r.suite}: ${r.label}: ${r.value}`;
}

export function recordResult(stateDir: string, r: MultiResult): void {
  appendFileSync(resultsPath(stateDir), `${JSON.stringify(r)}\n`, { mode: 0o600 });
  process.stdout.write(`${formatResult(r)}\n`);
}

export function readResults(stateDir: string): MultiResult[] {
  const p = resultsPath(stateDir);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as MultiResult);
}

export const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
