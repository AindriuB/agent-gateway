import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
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
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(repo, 'scripts/pack-module.mjs');
const manifestPath = path.join(repo, 'module.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const tmp = mkdtempSync(path.join(tmpdir(), 'pack-module-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

function fakeRoot(name, withBuild) {
  const root = path.join(tmp, name);
  mkdirSync(root);
  for (const f of ['module.json', 'LICENSE', 'lang', 'templates', 'styles']) {
    cpSync(path.join(repo, f), path.join(root, f), { recursive: true });
  }
  mkdirSync(path.join(root, 'examples/hello-pack'), { recursive: true });
  writeFileSync(path.join(root, 'examples/hello-pack/module.json'), '{}');
  mkdirSync(path.join(root, 'node_modules/x'), { recursive: true });
  writeFileSync(path.join(root, 'node_modules/x/i.js'), '');
  mkdirSync(path.join(root, 'module/src'), { recursive: true });
  writeFileSync(path.join(root, 'module/src/a.ts'), '');
  if (withBuild) {
    mkdirSync(path.join(root, 'dist/module'), { recursive: true });
    writeFileSync(path.join(root, 'dist/module/main.js'), 'export {};');
    writeFileSync(path.join(root, 'dist/module/main.d.ts'), '');
    writeFileSync(path.join(root, 'dist/module/main.js.map'), '{"sourcesContent":[]}');
    writeFileSync(path.join(root, 'dist/module/.DS_Store'), '');
    mkdirSync(path.join(root, 'lang/.hidden'));
    writeFileSync(path.join(root, 'lang/.hidden/x.json'), '{}');
    writeFileSync(path.join(root, '.DS_Store'), '');
    writeFileSync(path.join(root, 'styles/.DS_Store'), '');
  }
  return root;
}

const run = (root, extra = []) =>
  spawnSync('node', [script, '--root', root, ...extra], { encoding: 'utf8' });

describe('module.json', () => {
  it('declares no systems, so it loads in any world', () => {
    assert.equal(manifest.relationships?.systems, undefined);
  });

  it('never requires or recommends a pack', () => {
    assert.equal(manifest.relationships?.requires, undefined);
    assert.equal(manifest.relationships?.recommends, undefined);
  });

  it('download url matches the version', () => {
    assert.equal(
      manifest.download,
      `https://github.com/AindriuB/agent-gateway/releases/download/v${manifest.version}/agent-gateway.zip`,
    );
  });
});

describe('pack-module', () => {
  it('fails with one stderr line when the build is missing', () => {
    const r = run(fakeRoot('nobuild', false));
    assert.notEqual(r.status, 0);
    const lines = r.stderr.trim().split('\n');
    assert.equal(lines.length, 1);
    assert.match(lines[0], /dist\/module\/main\.js/);
  });

  it('gives a usage error when --root has no value', () => {
    const r = spawnSync('node', [script, '--root'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^pack-module: usage/);
  });

  it('writes a zip with only the allowed entries', () => {
    const root = fakeRoot('build', true);
    const r = run(root);
    assert.equal(r.status, 0, r.stderr);
    const zip = path.join(root, 'dist/release/agent-gateway.zip');
    const names = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    const allowed = /^(module\.json|LICENSE|(dist\/module|lang|templates|styles)\/.*)$/;
    for (const n of names) {
      assert.match(n, allowed, n);
      assert.doesNotMatch(n, /^(examples|node_modules|module\/src)\//);
      assert.doesNotMatch(n, /\.(ts|map)$/);
      assert.doesNotMatch(n, /(^|\/)\./);
    }
    assert.ok(names.includes('dist/module/main.js'));

    const zipped = execFileSync('unzip', ['-p', zip, 'module.json']);
    assert.ok(zipped.equals(readFileSync(manifestPath)));
    const paths = [
      ...manifest.esmodules,
      ...manifest.styles,
      ...manifest.languages.map((l) => l.path),
    ];
    for (const p of paths) assert.ok(names.includes(p), `missing ${p}`);
  });

  describe('--base-url', () => {
    const base = 'https://dl.example.test/agent-gateway';
    const unzipJson = (root) =>
      execFileSync('unzip', [
        '-p',
        path.join(root, 'dist/release/agent-gateway.zip'),
        'module.json',
      ]);

    it('rewrites manifest and download, with or without a trailing slash', () => {
      const root = fakeRoot('base', true);
      const before = readFileSync(path.join(root, 'module.json'));
      for (const url of [base, `${base}/`, `${base}//`]) {
        const r = run(root, ['--base-url', url]);
        assert.equal(r.status, 0, r.stderr);
        const zipped = unzipJson(root);
        const m = JSON.parse(zipped);
        assert.equal(m.manifest, `${base}/module.json`);
        assert.equal(m.download, `${base}/agent-gateway.zip`);
        assert.deepEqual(r.stdout.trim().split('\n'), [
          path.join(root, 'dist/release/agent-gateway.zip'),
          path.join(root, 'dist/release/module.json'),
        ]);
        assert.ok(zipped.equals(readFileSync(path.join(root, 'dist/release/module.json'))));
        assert.deepEqual(Object.keys(m), Object.keys(manifest));
        assert.deepEqual(
          { ...m, manifest: 0, download: 0 },
          { ...manifest, manifest: 0, download: 0 },
        );
        assert.ok(readFileSync(path.join(root, 'module.json')).equals(before));
        const names = execFileSync(
          'unzip',
          ['-Z1', path.join(root, 'dist/release/agent-gateway.zip')],
          { encoding: 'utf8' },
        )
          .split('\n')
          .filter(Boolean);
        assert.equal(names.filter((n) => n.endsWith('module.json')).length, 1);
        assert.ok(names.includes('module.json'));
      }
    });

    it('also accepts --base-url before --root', () => {
      const root = fakeRoot('baseorder', true);
      const r = spawnSync('node', [script, '--base-url', base, '--root', root], {
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, r.stderr);
    });

    it('rejects bad urls with one line that does not echo the value', () => {
      const bad = [
        'http://dl.example.test/x',
        'ftp://dl.example.test/x',
        'dl.example.test/x',
        'https://u:p@dl.example.test/x',
        'https://u@dl.example.test/x',
        'https://:p@dl.example.test/x',
        'https://dl.example.test/x?a=1',
        'https://dl.example.test/x#f',
      ];
      for (const url of bad) {
        const root = fakeRoot(`bad${bad.indexOf(url)}`, true);
        const r = run(root, ['--base-url', url]);
        assert.equal(r.status, 1, url);
        const lines = r.stderr.trim().split('\n');
        assert.equal(lines.length, 1);
        assert.match(lines[0], /^pack-module: --base-url must be an https URL/);
        assert.ok(!r.stderr.includes(url));
        assert.ok(!existsSync(path.join(root, 'dist/release/agent-gateway.zip')));
      }
    });

    it('leaves an earlier pack untouched when the url is rejected', () => {
      const root = fakeRoot('keep', true);
      assert.equal(run(root, ['--base-url', base]).status, 0);
      const r = run(root, ['--base-url', 'http://dl.example.test/x']);
      assert.equal(r.status, 1);
      assert.ok(existsSync(path.join(root, 'dist/release/agent-gateway.zip')));
      assert.ok(existsSync(path.join(root, 'dist/release/module.json')));
    });

    it('gives a usage error when the value is missing', () => {
      const root = fakeRoot('baseusage', true);
      for (const extra of [['--base-url'], ['--base-url', '--root']]) {
        const r = spawnSync('node', [script, '--root', root, ...extra], { encoding: 'utf8' });
        assert.equal(r.status, 1);
        assert.match(r.stderr, /^pack-module: usage/);
      }
    });

    it('removes a stale standalone module.json when run without the flag', () => {
      const root = fakeRoot('stale', true);
      assert.equal(run(root, ['--base-url', base]).status, 0);
      assert.ok(existsSync(path.join(root, 'dist/release/module.json')));
      const r = run(root);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(!existsSync(path.join(root, 'dist/release/module.json')));
      assert.equal(r.stdout.trim().split('\n').length, 1);
    });
  });
});
