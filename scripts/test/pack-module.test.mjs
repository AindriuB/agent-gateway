import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  }
  return root;
}

const run = (root) => spawnSync('node', [script, '--root', root], { encoding: 'utf8' });

describe('module.json', () => {
  it('lists exactly pf2e and dnd5e systems', () => {
    const systems = manifest.relationships.systems;
    assert.deepEqual(
      systems.map((s) => s.id),
      ['pf2e', 'dnd5e'],
    );
    assert.deepEqual(systems[0].compatibility, { minimum: '7.12', verified: '8.6.0' });
    assert.deepEqual(systems[1].compatibility, { minimum: '6.0', verified: '6.0.6' });
    for (const s of systems) assert.equal(s.type, 'system');
  });

  it('never requires or recommends a pack', () => {
    assert.equal(manifest.relationships.requires, undefined);
    assert.equal(manifest.relationships.recommends, undefined);
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
      assert.doesNotMatch(n, /\.ts$/);
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
});
