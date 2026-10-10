import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { RunRecord } from './rundata.js';

/** The parts of vitest's JSON reporter output that the summary reads. */
export interface VitestJson {
  testResults: Array<{
    name: string;
    assertionResults: Array<{ status: string }>;
  }>;
}

export interface SuiteCounts {
  pass: number;
  fail: number;
  skip: number;
}

export interface Summary {
  foundryUrl: string;
  foundryTarget: string;
  foundryVersion: string;
  suites: Record<string, SuiteCounts>;
  toolCounts: { gm?: number; player?: number };
  leakCheck: { results: number; strings: number; hits: number; line: string };
}

export function buildSummary(input: {
  foundryUrl: string;
  foundryTarget: string;
  vitest: VitestJson;
  records: readonly RunRecord[];
}): Summary {
  const suites: Record<string, SuiteCounts> = {};
  for (const file of input.vitest.testResults) {
    const c: SuiteCounts = { pass: 0, fail: 0, skip: 0 };
    for (const t of file.assertionResults) {
      if (t.status === 'passed') c.pass++;
      else if (t.status === 'failed') c.fail++;
      else c.skip++;
    }
    suites[basename(file.name).replace(/\.e2e\.test\.ts$/, '')] = c;
  }
  const toolCounts: Summary['toolCounts'] = {};
  let version = 'unknown';
  const leak = { results: 0, strings: 0, hits: 0 };
  for (const r of input.records) {
    if (r.kind === 'tools') toolCounts[r.role] = r.names.length;
    else if (r.kind === 'foundry') version = r.version;
    else if (r.kind === 'facts') continue;
    else {
      leak.results += r.results;
      leak.strings = Math.max(leak.strings, r.strings);
      leak.hits += r.hits;
    }
  }
  return {
    foundryUrl: input.foundryUrl,
    foundryTarget: input.foundryTarget,
    foundryVersion: version,
    suites,
    toolCounts,
    leakCheck: {
      ...leak,
      line: `leak check: ${leak.results} results x ${leak.strings} strings, ${leak.hits} hits`,
    },
  };
}

export function writeSummary(path: string, summary: Summary): void {
  writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
}

export function formatSummary(s: Summary): string {
  const lines = [`Foundry ${s.foundryVersion} (${s.foundryTarget}) at ${s.foundryUrl}`];
  for (const [name, c] of Object.entries(s.suites)) {
    lines.push(`  ${name}: ${c.pass} passed, ${c.fail} failed, ${c.skip} skipped`);
  }
  lines.push(`  tools: gm ${s.toolCounts.gm ?? '?'}, player ${s.toolCounts.player ?? '?'}`);
  lines.push(`  ${s.leakCheck.line}`);
  return lines.join('\n');
}

export function totalFailures(s: Summary): number {
  return Object.values(s.suites).reduce((n, c) => n + c.fail, 0);
}
