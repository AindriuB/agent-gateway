import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, readConfigFile } from '../../src/config/index.js';

describe('readConfigFile on invalid JSON', () => {
  for (const body of [
    '{"headlessPassword": hunter2}',
    "{'headlessPassword': 'hunter2'}",
    '{"headlessPassword": "hunter2" "x": 1}',
  ]) {
    it(`does not echo the file content for ${body}`, () => {
      const d = mkdtempSync(join(tmpdir(), 'ag-cfg-'));
      try {
        const f = join(d, 'config.json');
        writeFileSync(f, body);
        chmodSync(f, 0o600);
        let msg = '';
        try {
          readConfigFile(f);
        } catch (err) {
          expect(err).toBeInstanceOf(ConfigError);
          msg = (err as Error).message;
        }
        expect(msg).toContain('not valid JSON');
        expect(msg).not.toContain('hunter2');
        expect(msg).not.toContain('assword');
      } finally {
        rmSync(d, { recursive: true, force: true });
      }
    });
  }
});
