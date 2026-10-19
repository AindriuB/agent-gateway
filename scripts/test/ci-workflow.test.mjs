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
  it('has exactly pull_request, push and a bare workflow_dispatch', () => {
    assert.deepEqual(on.match(/^ {2}[\w_]+:/gm), [
      '  pull_request:',
      '  push:',
      '  workflow_dispatch:',
    ]);
    const pr = on.match(/^ {2}pull_request:\n((?: {4}.*\n)*)/m)[1];
    assert.equal(pr, '    branches: [main]\n');
    const push = on.match(/^ {2}push:\n((?: {4}.*\n)*)/m)[1];
    assert.equal(push, "    branches: [main]\n    tags: ['v*']\n");
    assert.match(on, /^ {2}workflow_dispatch:\n(?! {3})/m);
  });
  it('has no forbidden triggers', () => {
    for (const t of [
      'pull_request_target',
      'workflow_run',
      'issue_comment',
      'schedule',
      'release',
    ]) {
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
    ];
    let at = -1;
    for (const s of order) {
      const i = test.indexOf(s);
      assert.ok(i > at, `${s} in order`);
      at = i;
    }
    assert.doesNotMatch(test, /run: npm run test:scripts/);
  });
  it('is secret-free and does not persist credentials', () => {
    assert.doesNotMatch(test, /secrets\./);
    const checkout = test.match(/^ {6}- uses: actions\/checkout@v\d+\n((?: {8}.*\n)+)/m);
    assert.ok(checkout, 'checkout step');
    assert.match(checkout[1], /^ {8}with:\n {10}persist-credentials: false$/m);
  });
  it('runs the script tests through verify', () => {
    const pkg = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
    assert.ok(pkg.scripts.verify.endsWith('npm run test:scripts'));
  });
  it('runs the e2e unit tests and e2e type check through verify', () => {
    const pkg = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
    assert.match(pkg.scripts.verify, /npm run test:e2e-unit/);
    assert.match(pkg.scripts.verify, /npm run typecheck:e2e/);
  });
  it('never mentions live suites', () => {
    assert.doesNotMatch(wf, /test:e2e|e2e\.sh|test:conformance|conformance\.sh/);
  });
});

describe('image job', () => {
  it('needs test and only runs on v tags', () => {
    assert.match(image, /^ {4}needs: test$/m);
    assert.match(
      image,
      /^ {4}if: github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/v'\)$/m,
    );
  });
  it('checks the version before login or build', () => {
    assert.doesNotMatch(wf, /continue-on-error/);
    const step = image.match(/^ {6}- name: Check tag matches repo version\n((?: {8}.*\n)+)/m);
    assert.ok(step, 'version-check step');
    assert.doesNotMatch(step[1], /^ {8}if:/m);
    assert.match(
      step[1],
      /^ {8}run: node scripts\/bump-version\.mjs --check "\$\{GITHUB_REF_NAME#v\}"\n$/m,
    );
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
    assert.equal(wf.match(/concurrency:/g).length, 1);
    assert.equal(wf.match(/^concurrency:$/gm).length, 1);
    assert.equal(
      top('concurrency').trimEnd(),
      '  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}\n' +
        "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    );
    const groups = [...wf.matchAll(/^ {2}group: (.*)$/gm)].map((m) => m[1]);
    assert.deepEqual(groups, [
      '${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}',
    ]);
    const cancels = [...wf.matchAll(/cancel-in-progress:(.*)$/gm)].map((m) => m[1].trim());
    assert.deepEqual(cancels, ["${{ github.event_name == 'pull_request' }}"]);
  });
  it('uses the Node major the image uses', () => {
    const docker = readFileSync(path.join(repo, 'gateway/Dockerfile'), 'utf8');
    const majors = new Set([...docker.matchAll(/^FROM node:(\d+)/gm)].map((m) => m[1]));
    assert.equal(majors.size, 1);
    const versions = new Set([...wf.matchAll(/node-version: '(\d+)'/g)].map((m) => m[1]));
    assert.deepEqual([...versions], [...majors]);
  });
  it('keeps .github to the allowlisted files', () => {
    const allowed = [
      'FUNDING.yml',
      'ISSUE_TEMPLATE/bug_report.yml',
      'ISSUE_TEMPLATE/config.yml',
      'ISSUE_TEMPLATE/feature_request.yml',
      'pull_request_template.md',
      'workflows/ci.yml',
    ];
    const root = path.join(repo, '.github');
    const files = readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
      .sort();
    assert.ok(files.includes('workflows/ci.yml'));
    for (const f of files) assert.ok(allowed.includes(f), `${f} is not allowlisted`);
  });
});
