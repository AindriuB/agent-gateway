import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatResult, readResults, recordResult, seconds } from './results.js';

describe('results', () => {
  it('round-trips records and formats a line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ag-res-'));
    try {
      expect(readResults(dir)).toEqual([]);
      const r = { suite: 'isolation', label: 'frames', value: '4 / 0' };
      recordResult(dir, r);
      expect(readResults(dir)).toEqual([r]);
      expect(formatResult(r)).toBe('[multi] isolation: frames: 4 / 0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('formats seconds to one decimal', () => expect(seconds(12345)).toBe('12.3 s'));
});
