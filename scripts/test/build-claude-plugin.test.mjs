import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(repo, 'scripts/build-claude-plugin.mjs');
const tmp = mkdtempSync(path.join(tmpdir(), 'build-claude-plugin-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const walk = (dir) =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((n) => {
        const p = path.join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : [p];
      })
    : [];
const sha = (b) => createHash('sha256').update(b).digest('hex');
const hashes = (dir) => Object.fromEntries(walk(dir).map((f) => [f, sha(readFileSync(f))]));
const hasClaude =
  spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 15_000 }).status === 0;
const unzipList = (zip) =>
  spawnSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);

const BASE = 'https://dl.example.test/claude//';
const fresh = (n) => {
  const root = path.join(tmp, n);
  mkdirSync(root, { recursive: true });
  for (const d of ['plugins/claude', '.claude-plugin']) {
    cpSync(path.join(repo, d), path.join(root, d), { recursive: true });
  }
  cpSync(path.join(repo, 'package.json'), path.join(root, 'package.json'));
  return root;
};
const build = (root, ...a) =>
  spawnSync('node', [script, '--root', root, ...a], { encoding: 'utf8' });

describe('build-claude-plugin argument checks', () => {
  for (const [label, a] of [
    ['missing', []],
    ['no value', ['--base-url']],
    ['http', ['--base-url', 'http://x.test']],
    ['credentials', ['--base-url', 'https://u:p@x.test']],
    ['query', ['--base-url', 'https://x.test/?a=1']],
    ['fragment', ['--base-url', 'https://x.test/#f']],
    ['not a url', ['--base-url', 'not a url']],
  ]) {
    it(`rejects ${label} and writes nothing`, () => {
      const root = fresh(`bad-${label.replace(/ /g, '-')}`);
      const r = build(root, ...a);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /build-claude-plugin/);
      assert.equal(r.stdout, '');
      assert.ok(!existsSync(path.join(root, 'dist/release/claude')));
    });
  }
});

describe('build-claude-plugin output', () => {
  let root;
  let out;
  let version;
  let zip;
  let market;
  const before0 = {};
  before(() => {
    root = fresh('good');
    // Planted strays must not reach the zip.
    writeFileSync(path.join(root, 'plugins/claude/foundry-gateway/.DS_Store'), 'x');
    writeFileSync(path.join(root, 'plugins/claude/foundry-gateway/skills/.DS_Store'), 'x');
    writeFileSync(
      path.join(root, 'plugins/claude/foundry-gateway/skills/foundry-gateway/SKILL.md~'),
      'x',
    );
    for (const d of ['plugins', '.claude-plugin'])
      Object.assign(before0, hashes(path.join(root, d)));
    const listBefore = walk(root).sort();
    out = build(root, '--base-url', BASE);
    assert.equal(out.status, 0, out.stderr);
    const after0 = walk(root).filter((f) => !f.startsWith(path.join(root, 'dist/release/claude/')));
    assert.deepEqual(after0.sort(), listBefore);
    version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    zip = path.join(root, `dist/release/claude/plugins/foundry-gateway-${version}.zip`);
    market = JSON.parse(
      readFileSync(path.join(root, 'dist/release/claude/marketplace.json'), 'utf8'),
    );
  });

  it('prints exactly the two paths and the sha256', () => {
    const marketPath = path.join(root, 'dist/release/claude/marketplace.json');
    assert.deepEqual(out.stdout.trim().split('\n'), [zip, marketPath, sha(readFileSync(zip))]);
  });

  it('zips only the three plugin files under foundry-gateway/, byte-identical', () => {
    const entries = unzipList(zip);
    assert.ok(entries.every((e) => e.startsWith('foundry-gateway/')));
    assert.deepEqual(entries.filter((e) => !e.endsWith('/')).sort(), [
      'foundry-gateway/.claude-plugin/plugin.json',
      'foundry-gateway/.mcp.json',
      'foundry-gateway/skills/foundry-gateway/SKILL.md',
    ]);
    const x = path.join(tmp, 'extract');
    mkdirSync(x);
    assert.equal(spawnSync('unzip', ['-q', zip, '-d', x]).status, 0);
    for (const f of [
      '.claude-plugin/plugin.json',
      '.mcp.json',
      'skills/foundry-gateway/SKILL.md',
    ]) {
      assert.deepEqual(
        readFileSync(path.join(x, 'foundry-gateway', f)),
        readFileSync(path.join(repo, 'plugins/claude/foundry-gateway', f)),
      );
    }
  });

  it('marketplace.json points at the zip with its sha256 and has no version', () => {
    assert.equal(market.name, 'aindriub-dl');
    assert.ok(market.owner.name);
    assert.equal(market.plugins.length, 1);
    const [p] = market.plugins;
    assert.equal(p.name, 'foundry-gateway');
    assert.ok(!('version' in p));
    assert.equal(p.source.source, 'archive');
    assert.equal(
      p.source.url,
      `https://dl.example.test/claude/plugins/foundry-gateway-${version}.zip`,
    );
    assert.match(p.source.sha256, /^[0-9a-f]{64}$/);
    assert.equal(p.source.sha256, sha(readFileSync(zip)));
  });

  it('leaves the source tree untouched', () => {
    const now = {};
    for (const d of ['plugins', '.claude-plugin']) Object.assign(now, hashes(path.join(root, d)));
    assert.deepEqual(now, before0);
  });

  it('building against the real repo changes nothing outside dist/', () => {
    const watched = {
      ...hashes(path.join(repo, 'plugins/claude')),
      ...hashes(path.join(repo, '.claude-plugin')),
    };
    const r = spawnSync('node', [script, '--base-url', 'https://dl.example.test/claude'], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(
      {
        ...hashes(path.join(repo, 'plugins/claude')),
        ...hashes(path.join(repo, '.claude-plugin')),
      },
      watched,
    );
  });

  it('passes claude plugin validate --strict (plugin and marketplace)', (t) => {
    if (!hasClaude) return t.skip('claude CLI not found');
    const x = path.join(tmp, 'extract');
    const v1 = spawnSync(
      'claude',
      ['plugin', 'validate', path.join(x, 'foundry-gateway'), '--strict'],
      {
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    assert.equal(v1.status, 0, v1.stdout + v1.stderr);
    const mdir = path.join(tmp, 'market');
    mkdirSync(path.join(mdir, '.claude-plugin'), { recursive: true });
    cpSync(
      path.join(root, 'dist/release/claude/marketplace.json'),
      path.join(mdir, '.claude-plugin/marketplace.json'),
    );
    const v2 = spawnSync('claude', ['plugin', 'validate', mdir, '--strict'], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(v2.status, 0, v2.stdout + v2.stderr);
  });
});
