import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
it('reproduces actual tsx closure serialization failure and installs compiled observer in an isolated browser realm', () => {
  const probe = fileURLToPath(new URL('./native-serialization-probe.mts', import.meta.url));
  const result = execFileSync(process.execPath, ['--import', 'tsx', probe], {
    encoding: 'utf8',
    timeout: 15000,
  });
  expect(result).toContain('actual-tsx isolated-browser serialization PASS');
});
