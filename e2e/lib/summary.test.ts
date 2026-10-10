import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRunData, recordRunData, resetRunData, type RunRecord } from './rundata.js';
import { buildSummary, formatSummary, totalFailures, writeSummary } from './summary.js';

const vitest = {
  testResults: [
    {
      name: '/r/e2e/read/player.e2e.test.ts',
      assertionResults: [{ status: 'passed' }, { status: 'passed' }, { status: 'failed' }],
    },
    {
      name: '/r/e2e/read/gm.e2e.test.ts',
      assertionResults: [{ status: 'passed' }, { status: 'pending' }, { status: 'skipped' }],
    },
  ],
};

describe('buildSummary', () => {
  const records: RunRecord[] = [
    { kind: 'tools', role: 'gm', names: ['a', 'b', 'c'] },
    { kind: 'tools', role: 'player', names: ['a', 'b'] },
    { kind: 'leak', results: 10, strings: 20, hits: 0 },
    { kind: 'facts', limitedPackUuid: 'x' },
    { kind: 'foundry', version: '14.369' },
  ];
  const s = buildSummary({ foundryUrl: 'https://f', foundryTarget: 'v14', vitest, records });

  it('counts per suite', () => {
    expect(s.suites).toEqual({
      player: { pass: 2, fail: 1, skip: 0 },
      gm: { pass: 1, fail: 0, skip: 2 },
    });
    expect(totalFailures(s)).toBe(1);
  });
  it('reports tool counts, version and the leak line', () => {
    expect(s.toolCounts).toEqual({ gm: 3, player: 2 });
    expect(s.foundryVersion).toBe('14.369');
    expect(s.leakCheck.line).toBe('leak check: 10 results x 20 strings, 0 hits');
    expect(formatSummary(s)).toContain('tools: gm 3, player 2');
  });
  it('writes 0600 JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ag-e2e-sum-'));
    try {
      const p = join(dir, 'e2e-summary.json');
      writeSummary(p, s);
      expect(JSON.parse(readFileSync(p, 'utf8')).foundryUrl).toBe('https://f');
      expect(statSync(p).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('run data', () => {
  it('round-trips records and resets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ag-e2e-rd-'));
    try {
      const p = join(dir, 'run-data.jsonl');
      expect(readRunData(p)).toEqual([]);
      recordRunData(p, { kind: 'foundry', version: '1' });
      recordRunData(p, { kind: 'leak', results: 1, strings: 2, hits: 0 });
      expect(readRunData(p)).toHaveLength(2);
      resetRunData(p);
      expect(readRunData(p)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
