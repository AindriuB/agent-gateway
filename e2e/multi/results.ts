import { recordRunData } from '../lib/rundata.js';
import { join } from 'node:path';

export interface MultiResult {
  suite: string;
  label: string;
  value: number | string;
}

export const runDataPath = (stateDir: string): string => join(stateDir, 'run-data.jsonl');

export function formatResult(r: MultiResult): string {
  return `[multi] ${r.suite}: ${r.label}: ${r.value}`;
}

/** Add a measurement to the 12a run data (which the summary reads) and print it. */
export function recordResult(stateDir: string, r: MultiResult): void {
  recordRunData(runDataPath(stateDir), { kind: 'multi', ...r });
  process.stdout.write(`${formatResult(r)}\n`);
}

export const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
