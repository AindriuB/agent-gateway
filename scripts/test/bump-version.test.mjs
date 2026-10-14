import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(repo, 'scripts/bump-version.mjs');
// Fixture files come from the repo, or from BUMP_TEST_FIXTURES (the regression test below points
// this at a root that has already been bumped). Nothing here may assume the repo's own version.
const fixtures = process.env.BUMP_TEST_FIXTURES ?? repo;
const start = JSON.parse(readFileSync(path.join(fixtures, 'package.json'), 'utf8')).version;
const STALE = '0.0.1-stale';
const files = [
  'package.json',
  'protocol/package.json',
  'module/package.json',
  'gateway/package.json',
  'package-lock.json',
  'module.json',
  'gateway/mcpb/manifest.json',
  'gateway/docker/.env.example',
];
const tmp = mkdtempSync(path.join(tmpdir(), 'bump-version-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

let root;
let n = 0;
beforeEach(() => {
  root = path.join(tmp, `r${n++}`);
  for (const f of files) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    cpSync(path.join(fixtures, f), path.join(root, f));
  }
});
const run = (...a) => spawnSync('node', [script, ...a, '--root', root], { encoding: 'utf8' });
const json = (f) => JSON.parse(readFileSync(path.join(root, f), 'utf8'));

describe('bump-version', () => {
  it('this suite still passes after a bump (the release runs it with the bumped files)', () => {
    if (process.env.BUMP_TEST_FIXTURES) return; // already the nested run
    const bumped = path.join(tmp, 'bumped');
    for (const f of files) {
      mkdirSync(path.dirname(path.join(bumped, f)), { recursive: true });
      cpSync(path.join(repo, f), path.join(bumped, f));
    }
    const b = spawnSync('node', [script, '9.9.9', '--root', bumped], { encoding: 'utf8' });
    assert.equal(b.status, 0, b.stderr);
    const r = spawnSync('node', ['--test', fileURLToPath(import.meta.url)], {
      encoding: 'utf8',
      env: { ...process.env, BUMP_TEST_FIXTURES: bumped },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it('sets the version in every file and keeps --check green', () => {
    const r = run('9.8.7');
    assert.equal(r.status, 0, r.stderr);
    for (const f of [
      'package.json',
      'protocol/package.json',
      'module/package.json',
      'gateway/package.json',
    ]) {
      assert.equal(json(f).version, '9.8.7', f);
    }
    assert.equal(json('gateway/mcpb/manifest.json').version, '9.8.7');
    const mod = json('module.json');
    assert.equal(mod.version, '9.8.7');
    assert.match(mod.download, /\/releases\/download\/v9\.8\.7\/agent-gateway\.zip$/);
    const lock = json('package-lock.json');
    assert.equal(lock.version, '9.8.7');
    for (const k of ['', 'protocol', 'module', 'gateway']) {
      assert.equal(lock.packages[k].version, '9.8.7', `lock ${k}`);
    }
    const env = readFileSync(path.join(root, 'gateway/docker/.env.example'), 'utf8');
    assert.equal(env.match(/^GATEWAY_VERSION=9\.8\.7$/gm).length, 1);
    const orig = readFileSync(path.join(fixtures, 'gateway/docker/.env.example'), 'utf8');
    const lines = (t) => t.split('\n').filter((l) => !l.startsWith('GATEWAY_VERSION='));
    assert.deepEqual(lines(env), lines(orig));
    assert.equal(run('--check').status, 0);
    assert.equal(run('--check', '9.8.7').status, 0);
    assert.notEqual(run('--check', '1.0.0').status, 0);
  });

  it('--check fails when any file disagrees', () => {
    const f = path.join(root, 'gateway/mcpb/manifest.json');
    writeFileSync(
      f,
      readFileSync(f, 'utf8').replace(/"version": "[^"]*"/, `"version": "${STALE}"`),
    );
    const r = run('--check');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /manifest\.json is 0\.0\.1-stale/);
  });

  it('bumps the internal workspace pin, and --check fails when only the pin disagrees', () => {
    assert.equal(json('module/package.json').dependencies['@agent-gateway/protocol'], start);
    assert.equal(run('4.5.6').status, 0);
    assert.equal(json('module/package.json').dependencies['@agent-gateway/protocol'], '4.5.6');
    assert.equal(
      json('package-lock.json').packages.module.dependencies['@agent-gateway/protocol'],
      '4.5.6',
    );
    assert.equal(run('--check').status, 0);
    const f = path.join(root, 'module/package.json');
    writeFileSync(
      f,
      readFileSync(f, 'utf8').replace(
        '"@agent-gateway/protocol": "4.5.6"',
        `"@agent-gateway/protocol": "${STALE}"`,
      ),
    );
    const r = run('--check');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /pin @agent-gateway\/protocol is 0\.0\.1-stale/);
  });

  it('--check fails when only the .env.example pin disagrees', () => {
    const f = path.join(root, 'gateway/docker/.env.example');
    writeFileSync(
      f,
      readFileSync(f, 'utf8').replace(/^GATEWAY_VERSION=.*$/m, `GATEWAY_VERSION=${STALE}`),
    );
    const r = run('--check');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /\.env\.example.* is 0\.0\.1-stale/);
  });

  it('--check fails when only the download tag disagrees', () => {
    const f = path.join(root, 'module.json');
    writeFileSync(f, readFileSync(f, 'utf8').replace('/download/v', '/download/v1'));
    assert.notEqual(run('--check').status, 0);
  });

  it('rejects a bad version and changes nothing', () => {
    const before = readFileSync(path.join(root, 'module.json'), 'utf8');
    assert.notEqual(run('banana').status, 0);
    assert.equal(readFileSync(path.join(root, 'module.json'), 'utf8'), before);
  });
});
