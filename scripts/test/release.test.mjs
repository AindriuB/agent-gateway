import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// Everything runs in a temp git repo with stub gh/npm on PATH; nothing real is published.
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = mkdtempSync(path.join(tmpdir(), 'release-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const copied = [
  'package.json',
  'protocol/package.json',
  'module/package.json',
  'gateway/package.json',
  'package-lock.json',
  'module.json',
  'gateway/mcpb/manifest.json',
  'gateway/docker/.env.example',
  'plugins/claude/foundry-gateway/.claude-plugin/plugin.json',
  'docs/releasing.md',
  'scripts/bump-version.mjs',
];
const fakeBuild = (body) => `import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync(${JSON.stringify('dist/release')}, { recursive: true });
${body}`;

const stubNpm = `#!/usr/bin/env bash
echo "npm $*" >> "$STUB_LOG"
case "$*" in
  "run verify"|"run test:scripts"|"run test:e2e -- --foundry v14") [ "$FAIL_GATE" = "$*" ] && exit 1; exit 0;;
  "run test:conformance")
    [ "$FAIL_GATE" = "$*" ] && exit 1
    echo "$CONFORMANCE_OUT"; exit 0;;
  "run test:e2e -- --foundry v13")
    [ -n "$V13_SKIP" ] && echo "SKIP: v13 instance not configured (set AGENT_GATEWAY_E2E_V13_URL)"
    [ -n "$OTHER_SKIP" ] && echo "SKIP: player2 not configured"
    exit 0;;
  pack\\ *)
    dest="\${@: -1}"
    echo tgz > "$dest/foundry-agent-gateway-$(node -p "require('./gateway/package.json').version").tgz"; exit 0;;
  publish*) exit 0;;
esac
exit 0
`;
const stubGh = `#!/usr/bin/env bash
echo "gh $*" >> "$STUB_LOG"
while [ $# -gt 0 ]; do
  if [ "$1" = "--notes-file" ]; then cat "$2" >> "$STUB_LOG"; fi
  shift
done
exit 0
`;

let root;
let bin;
let log;
let n = 0;
beforeEach(() => {
  const dir = path.join(tmp, `t${n++}`);
  root = path.join(dir, 'repo');
  bin = path.join(dir, 'bin');
  log = path.join(dir, 'log');
  mkdirSync(bin, { recursive: true });
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  for (const f of copied) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    cpSync(path.join(repo, f), path.join(root, f));
  }
  writeFileSync(
    path.join(root, 'scripts/pack-module.mjs'),
    fakeBuild(`writeFileSync('dist/release/agent-gateway.zip', 'zip');`),
  );
  writeFileSync(
    path.join(root, 'scripts/build-mcpb.mjs'),
    fakeBuild(`writeFileSync('dist/release/foundry-agent-gateway.mcpb', 'mcpb');`),
  );
  for (const [name, body] of [
    ['npm', stubNpm],
    ['gh', stubGh],
  ]) {
    writeFileSync(path.join(bin, name), body);
    chmodSync(path.join(bin, name), 0o755);
  }
  writeFileSync(log, '');
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
});

const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
const OK = 'conformance: ok (inspector 2.10.1, stdio, http)';
function release(args, { input = '', env = {} } = {}) {
  return spawnSync('node', [path.join(repo, 'scripts/release.mjs'), ...args, '--root', root], {
    cwd: root,
    input,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: path.join(tmp, 'home'),
      STUB_LOG: log,
      CONFORMANCE_OUT: OK,
      ...env,
    },
  });
}
const calls = () => readFileSync(log, 'utf8');

describe('release preconditions', () => {
  it('exits non-zero on a dirty tree', () => {
    writeFileSync(path.join(root, 'dirty.txt'), 'x');
    const r = release(['1.0.0']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not clean/);
    assert.equal(calls(), '');
  });

  it('exits non-zero off main', () => {
    git('checkout', '-q', '-b', 'feature');
    const r = release(['1.0.0']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /must be on main/);
    assert.equal(calls(), '');
  });
});

describe('release gates', () => {
  it('aborts on a failing gate and runs nothing after it', () => {
    const r = release(['1.0.0', '--allow-missing-v13'], {
      input: 'yes\n',
      env: { FAIL_GATE: 'run test:scripts' },
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /gate failed: test:scripts/);
    assert.doesNotMatch(calls(), /conformance|gh release/);
  });

  it('aborts when conformance did not run the http mode', () => {
    const r = release(['1.0.0', '--allow-missing-v13'], {
      input: 'yes\n',
      env: { CONFORMANCE_OUT: 'conformance: ok (inspector 2.10.1, stdio)' },
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /gate failed: test:conformance/);
    assert.doesNotMatch(calls(), /gh release/);
  });

  it('aborts on a v13 SKIP unless --allow-missing-v13, and prints it then', () => {
    const env = { V13_SKIP: '1' };
    const a = release(['1.0.0'], { input: 'yes\n', env });
    assert.notEqual(a.status, 0);
    assert.match(a.stderr, /v13 was skipped/);
    assert.doesNotMatch(calls(), /gh release/);
    // The first run left a bumped, dirty tree; reset it for the second attempt.
    git('checkout', '-q', '--', '.');
    git('clean', '-fdq');
    const b = release(['1.0.0', '--allow-missing-v13'], { input: 'no\n', env });
    assert.equal(b.status, 0, b.stderr);
    assert.match(b.stdout, /SKIPPED \(--allow-missing-v13\)|v13 e2e gate was SKIPPED/);
  });

  it('ignores an unrelated SKIP line from a configured v13 run', () => {
    const r = release(['1.0.0'], { input: 'no\n', env: { OTHER_SKIP: '1' } });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /SKIPPED/);
    assert.match(r.stdout, /v13 e2e: passed|Planned actions/);
  });

  it('uses the same v13 skip text as e2e/lib/args.ts', () => {
    const ts = readFileSync(path.join(repo, 'e2e/lib/args.ts'), 'utf8');
    const msg = /V13_SKIP_MESSAGE = '([^']+)'/.exec(ts)[1];
    const js = readFileSync(path.join(repo, 'scripts/release.mjs'), 'utf8');
    assert.ok(js.includes(`'${msg}'`));
  });

  it('runs the gates in order', () => {
    release(['1.0.0'], { input: 'no\n' });
    const order = calls()
      .split('\n')
      .filter((l) => l.startsWith('npm run'));
    assert.deepEqual(order, [
      'npm run verify',
      'npm run test:scripts',
      'npm run test:conformance',
      'npm run test:e2e -- --foundry v14',
      'npm run test:e2e -- --foundry v13',
    ]);
  });
});

describe('release upload', () => {
  it('bumps, builds, hashes, shows the plan and uploads nothing unless the answer is yes', () => {
    const r = release(['1.2.3'], { input: 'y\n' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Planned actions/);
    assert.match(r.stdout, /Ask Foundry checklist: 0 of 6 answered/);
    for (const f of [
      'agent-gateway.zip',
      'foundry-agent-gateway-1.2.3.tgz',
      'foundry-agent-gateway.mcpb',
    ]) {
      assert.match(r.stdout, new RegExp(`[0-9a-f]{64}  dist/release/${f.replaceAll('.', '\\.')}`));
      assert.ok(existsSync(path.join(root, 'dist/release', f)), f);
    }
    assert.doesNotMatch(calls(), /gh |npm publish/);
    assert.equal(JSON.parse(readFileSync(path.join(root, 'module.json'), 'utf8')).version, '1.2.3');
  });

  it('after yes creates only a draft with the notes, then a dry-run publish', () => {
    const r = release(['1.2.3'], { input: 'yes\n' });
    assert.equal(r.status, 0, r.stderr);
    const out = calls();
    const ghLine = out.split('\n').find((l) => l.startsWith('gh release create'));
    assert.match(ghLine, /^gh release create v1\.2\.3 --draft /);
    assert.match(ghLine, /--notes-file /);
    assert.match(ghLine, /agent-gateway\.zip/);
    assert.match(ghLine, /module\.json/);
    assert.match(ghLine, /foundry-agent-gateway\.mcpb/);
    assert.match(out, /Platforms: macOS verified; Windows untested in this release/);
    assert.match(out, /npm publish -w gateway --dry-run/);
    assert.doesNotMatch(out, /npm publish -w gateway\n/);
    assert.doesNotMatch(out, /gh release (edit|publish)/);
  });

  it('counts answered checklist entries', () => {
    const f = path.join(root, 'docs/releasing.md');
    writeFileSync(f, readFileSync(f, 'utf8').replace('- Answer:\n', '- Answer: yes, allowed\n'));
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'answer');
    const r = release(['1.2.3'], { input: 'no\n' });
    assert.match(r.stdout, /Ask Foundry checklist: 1 of 6 answered/);
  });

  it('never really publishes to npm without --publish-npm', () => {
    release(['1.2.3'], { input: 'yes\npublish foundry-agent-gateway@1.2.3\n' });
    assert.doesNotMatch(calls(), /npm publish -w gateway\n/);
  });

  it('with --publish-npm needs the exact second confirmation', () => {
    const bad = release(['1.2.3', '--publish-npm'], { input: 'yes\nyes\n' });
    assert.equal(bad.status, 0, bad.stderr);
    assert.doesNotMatch(calls(), /npm publish -w gateway\n/);
    git('checkout', '-q', '--', '.');
    git('clean', '-fdq');
    writeFileSync(log, '');
    const good = release(['1.2.3', '--publish-npm'], {
      input: 'yes\npublish foundry-agent-gateway@1.2.3\n',
    });
    assert.equal(good.status, 0, good.stderr);
    assert.match(calls(), /npm publish -w gateway\n/);
    assert.match(calls(), /gh release create v1\.2\.3 --draft/);
  });
});
