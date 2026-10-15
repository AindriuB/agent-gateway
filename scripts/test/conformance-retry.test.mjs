import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const helper = path.join(repo, 'scripts/lib/inspector-retry.sh');
const tmp = mkdtempSync(path.join(tmpdir(), 'retry429-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;
// stub body is bash; $count is the call number (1-based).
function run(body) {
  const dir = path.join(tmp, String(++n));
  spawnSync('mkdir', ['-p', dir]);
  const stub = path.join(dir, 'stub.sh');
  const counter = path.join(dir, 'count');
  const log = path.join(dir, 'log');
  writeFileSync(stub, `#!/usr/bin/env bash\necho x >> "${counter}"\ncount=$(wc -l < "${counter}")\n${body}\n`);
  chmodSync(stub, 0o755);
  const r = spawnSync('bash', ['-c', `. "${helper}"; retry_429 "${log}" "${stub}"`], {
    encoding: 'utf8',
    env: { ...process.env, CONFORMANCE_429_BACKOFF: '0' },
  });
  const calls = readFileSync(counter, 'utf8').trim().split('\n').length;
  return { r, calls, log: readFileSync(log, 'utf8') };
}

describe('retry_429', () => {
  it('retries a 429 until the call succeeds', () => {
    const { r, calls, log } = run(
      'if [ "$count" -lt 3 ]; then echo "Error POSTing to endpoint: too many requests" >&2; exit 1; fi; echo ok',
    );
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), 'ok');
    assert.equal(calls, 3);
    assert.equal(log.split('\n').filter((l) => l.includes('retrying')).length, 2);
  });

  it('gives up after 4 attempts', () => {
    const { r, calls } = run('echo "Error POSTing to endpoint: too many requests" >&2; exit 1');
    assert.notEqual(r.status, 0);
    assert.equal(calls, 4);
  });

  it('does not retry other failures', () => {
    const { r, calls, log } = run('echo "Error POSTing to endpoint: unauthorized" >&2; exit 1');
    assert.notEqual(r.status, 0);
    assert.equal(calls, 1);
    assert.match(log, /unauthorized/);
  });

  it('never retries a zero exit', () => {
    const { r, calls } = run('echo "too many requests"');
    assert.equal(r.status, 0);
    assert.equal(calls, 1);
  });
});
