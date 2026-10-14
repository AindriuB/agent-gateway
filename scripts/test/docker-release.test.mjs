import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// The image step of release.mjs, in a temp git repo with stub tools; nothing real runs.
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = mkdtempSync(path.join(tmpdir(), 'docker-release-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const copied = [
  'package.json',
  'protocol/package.json',
  'module/package.json',
  'gateway/package.json',
  'package-lock.json',
  'module.json',
  'gateway/mcpb/manifest.json',
  'docs/releasing.md',
  'scripts/bump-version.mjs',
];
const fake = (body) => `import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('dist/release', { recursive: true });
${body}`;
const stub = `#!/usr/bin/env bash
echo "$(basename "$0") $*" >> "$STUB_LOG"
case "$(basename "$0") $*" in
  "npm run test:conformance") echo "conformance: ok (inspector 2.10.1, stdio, http)";;
  npm\\ pack*) echo tgz > "\${@: -1}/foundry-agent-gateway-$(node -p "require('./gateway/package.json').version").tgz";;
esac
[ "$(basename "$0") $*" = "docker build -f gateway/Dockerfile -t foundry-agent-gateway:1.2.3 ." ] && [ -n "$FAIL_DOCKER" ] && exit 1
exit 0
`;

let n = 0;
function setup() {
  const dir = path.join(tmp, `t${n++}`);
  const root = path.join(dir, 'repo');
  const bin = path.join(dir, 'bin');
  const log = path.join(dir, 'log');
  mkdirSync(bin, { recursive: true });
  for (const f of copied) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    cpSync(path.join(repo, f), path.join(root, f));
  }
  writeFileSync(path.join(root, 'gateway/Dockerfile'), 'FROM scratch\n');
  writeFileSync(
    path.join(root, 'scripts/pack-module.mjs'),
    fake(`writeFileSync('dist/release/agent-gateway.zip', 'z');`),
  );
  writeFileSync(
    path.join(root, 'scripts/build-mcpb.mjs'),
    fake(`writeFileSync('dist/release/foundry-agent-gateway.mcpb', 'm');`),
  );
  for (const name of ['npm', 'gh', 'docker']) {
    writeFileSync(path.join(bin, name), stub);
    chmodSync(path.join(bin, name), 0o755);
  }
  writeFileSync(log, '');
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  const release = (args, env = {}) =>
    spawnSync('node', [path.join(repo, 'scripts/release.mjs'), ...args, '--root', root], {
      cwd: root,
      input: '',
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: tmp, STUB_LOG: log, ...env },
    });
  return { release, calls: () => readFileSync(log, 'utf8') };
}

describe('release image step', () => {
  it('builds and tags the image locally and pushes nothing', () => {
    const { release, calls } = setup();
    const r = release(['1.2.3', '--allow-missing-v13']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(
      calls(),
      /^docker build -f gateway\/Dockerfile -t foundry-agent-gateway:1\.2\.3 \.$/m,
    );
    assert.doesNotMatch(calls(), /docker (push|tag|login)/);
    assert.match(r.stdout, /image foundry-agent-gateway:1\.2\.3 \(local only, not pushed\)/);
  });

  it('fails the release when the image build fails', () => {
    const { release } = setup();
    const r = release(['1.2.3', '--allow-missing-v13'], { FAIL_DOCKER: '1' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /docker build failed/);
  });

  it('--push-image says the registry is not configured, exits non-zero and runs nothing', () => {
    const { release, calls } = setup();
    const r = release(['1.2.3', '--push-image']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /registry not configured/);
    assert.equal(calls(), '');
  });
});
