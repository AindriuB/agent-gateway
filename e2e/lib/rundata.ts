import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';

/** Facts the suites record for the summary. One JSON object per line in the state directory. */
export type RunRecord =
  | { kind: 'tools'; role: 'gm' | 'player'; names: string[] }
  | { kind: 'leak'; results: number; strings: number; hits: number }
  | { kind: 'facts'; limitedPackUuid?: string }
  | { kind: 'foundry'; version: string; generation?: number };

export function resetRunData(path: string): void {
  rmSync(path, { force: true });
}

export function recordRunData(path: string, rec: RunRecord): void {
  appendFileSync(path, `${JSON.stringify(rec)}\n`, { mode: 0o600 });
}

export function readRunData(path: string): RunRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as RunRecord);
}
