import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const wf = readFileSync(path.join(repo, '.github/workflows/ci.yml'), 'utf8');
const lines = wf.split('\n');

// Text of a top-level section ("name:" at column 0) up to the next one.
const top = (name) => {
  const m = wf.match(new RegExp(`^${name}:\\n((?:[ \\t].*\\n|\\n)*)`, 'm'));
  assert.ok(m, `${name} present`);
  return m[1];
};
// Text of one job body.
const job = (name) => {
  const m = top('jobs').match(new RegExp(`^  ${name}:\\n((?:    .*\\n|\\n)*)`, 'm'));
  assert.ok(m, `job ${name} present`);
  return m[1];
};
const test = job('test');
const image = job('image');

describe('ci.yml triggers', () => {
  const on = top('on');
  it('has exactly pull_request, push branches and push tags', () => {
    assert.deepEqual(on.match(/^ {2}[\w_]+:/gm), ['  pull_request:', '  push:']);
    assert.match(on, /^ {2}pull_request:\n {4}branches: \[main\]$/m);
    assert.match(on, /^ {2}push:\n {4}branches: \[main\]\n {4}tags: \['v\*'\]$/m);
  });
  it('has no forbidden triggers', () => {
    for (const t of ['workflow_dispatch', 'pull_request_target', 'schedule', 'release']) {
      assert.doesNotMatch(on, new RegExp(`^\\s*${t}:`, 'm'));
    }
  });
});

describe('ci.yml permissions', () => {
  it('is read-only at top level, packages write only in image', () => {
    assert.equal(top('permissions').trim(), 'contents: read');
    assert.match(image, /^ {4}permissions:\n {6}contents: read\n {6}packages: write\n/m);
    assert.doesNotMatch(test, /permissions:/);
    assert.deepEqual(wf.match(/^\s*[\w-]+: write$/gm), ['      packages: write']);
  });
});

describe('test job', () => {
  it('runs the gate in order on ubuntu-latest', () => {
    assert.match(test, /^ {4}runs-on: ubuntu-latest$/m);
    const order = [
      'actions/checkout@',
      'actions/setup-node@',
      "node-version: '22'",
      'npm ci',
      'npm run verify',
      'npm run test:scripts',
    ];
    let at = -1;
    for (const s of order) {
      const i = test.indexOf(s);
      assert.ok(i > at, `${s} in order`);
      at = i;
    }
  });
  it('never mentions live suites', () => {
    assert.doesNotMatch(wf, /test:e2e|e2e\.sh|test:conformance|conformance\.sh/);
  });
});

describe('image job', () => {
  it('needs test and only runs on v tags', () => {
    assert.match(image, /^ {4}needs: test$/m);
    assert.match(image, /^ {4}if: startsWith\(github\.ref, 'refs\/tags\/v'\)$/m);
  });
  it('checks the version before login or build', () => {
    assert.doesNotMatch(wf, /continue-on-error/);
    const step = image.match(/^ {6}- name: Check tag matches repo version\n((?: {8}.*\n)+)/m);
    assert.ok(step, 'version-check step');
    assert.doesNotMatch(step[1], /^ {8}if:/m);
    const check = image.indexOf('node scripts/bump-version.mjs --check "${GITHUB_REF_NAME#v}"');
    assert.ok(check >= 0);
    assert.ok(check < image.indexOf('docker/login-action@'));
    assert.ok(check < image.indexOf('docker/build-push-action@'));
  });
  it('logs in with the built-in token', () => {
    assert.match(image, /registry: ghcr\.io/);
    assert.match(image, /username: \$\{\{ github\.actor \}\}/);
    assert.match(image, /password: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  });
  it('builds multi-arch from the repo root', () => {
    assert.match(image, /docker\/setup-qemu-action@/);
    assert.match(image, /docker\/setup-buildx-action@/);
    assert.match(image, /^ {10}context: \.$/m);
    assert.match(image, /^ {10}file: gateway\/Dockerfile$/m);
    assert.match(image, /^ {10}platforms: linux\/amd64,linux\/arm64$/m);
    assert.match(image, /^ {10}push: true$/m);
    assert.match(image, /tags: \$\{\{ steps\.meta\.outputs\.tags \}\}/);
    assert.match(image, /labels: \$\{\{ steps\.meta\.outputs\.labels \}\}/);
  });
  it('has the exact metadata rules', () => {
    assert.match(image, /images: ghcr\.io\/aindriub\/foundry-agent-gateway$/m);
    const m = image.match(/^ {10}tags: \|\n((?: {12}.*\n)+)/m);
    assert.ok(m, 'metadata tags block');
    assert.deepEqual(
      m[1]
        .split('\n')
        .filter(Boolean)
        .map((l) => l.trim()),
      ['type=semver,pattern={{version}}', 'type=semver,pattern={{major}}.{{minor}}', 'type=sha'],
    );
    assert.doesNotMatch(wf, /type=raw/);
    assert.doesNotMatch(wf.replaceAll('ubuntu-latest', '').replaceAll('latest=auto', ''), /latest/);
  });
});

describe('ci.yml hygiene', () => {
  it('has no ${{ inside run blocks', () => {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*)(?:- )?run:\s*(.*)$/);
      if (!m) continue;
      assert.doesNotMatch(m[2], /\$\{\{/, `line ${i + 1}`);
      if (/^[|>]/.test(m[2])) {
        const indent = m[1].length;
        for (
          let j = i + 1;
          j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) > indent);
          j++
        ) {
          assert.doesNotMatch(lines[j], /\$\{\{/, `line ${j + 1}`);
        }
      }
    }
  });
  it('uses only secrets.GITHUB_TOKEN', () => {
    const refs = wf.match(/secrets\.[\w]+/g);
    assert.ok(refs?.length);
    assert.ok(refs.every((r) => r === 'secrets.GITHUB_TOKEN'));
  });
  it('pins every action to a major tag', () => {
    const uses = [...wf.matchAll(/^\s*(?:- )?uses: (\S+)$/gm)].map((m) => m[1]);
    assert.ok(uses.length >= 7);
    for (const u of uses) assert.match(u, /@v\d+$/);
  });
  it('sets timeouts and never cancels tag runs', () => {
    assert.ok(Number(test.match(/^ {4}timeout-minutes: (\d+)$/m)?.[1]) <= 30);
    assert.ok(Number(image.match(/^ {4}timeout-minutes: (\d+)$/m)?.[1]) <= 60);
    assert.doesNotMatch(wf, /cancel-in-progress:/);
  });
  it('uses the Node major the image uses', () => {
    const docker = readFileSync(path.join(repo, 'gateway/Dockerfile'), 'utf8');
    const majors = new Set([...docker.matchAll(/^FROM node:(\d+)/gm)].map((m) => m[1]));
    assert.equal(majors.size, 1);
    const versions = new Set([...wf.matchAll(/node-version: '(\d+)'/g)].map((m) => m[1]));
    assert.deepEqual([...versions], [...majors]);
  });
  it('is the only file under .github', () => {
    const files = readdirSync(path.join(repo, '.github'), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
    assert.deepEqual(files, ['ci.yml']);
  });
});
