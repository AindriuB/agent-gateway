import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(readFileSync(path.join(repo, 'gateway/package.json'), 'utf8'));
const source = JSON.parse(readFileSync(path.join(repo, 'gateway/mcpb/manifest.json'), 'utf8'));
const tmp = mkdtempSync(path.join(tmpdir(), 'build-mcpb-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

describe('gateway/mcpb/manifest.json', () => {
  it('matches the gateway package and declares the runtime', () => {
    assert.equal(source.server.type, 'node');
    assert.equal(source.version, pkg.version);
    assert.equal(source.compatibility.runtimes.node, '>=22.13');
    assert.ok(source.compatibility.platforms.includes('darwin'));
    assert.ok(source.compatibility.platforms.includes('win32'));
    assert.equal(source.tools_generated, true);
    assert.equal(source.tools, undefined);
  });

  it('exposes only known env settings and no secrets', () => {
    const allowed = new Set([
      'AGENT_GATEWAY_LINK_PORT',
      'AGENT_GATEWAY_HTTP_PORT',
      'AGENT_GATEWAY_ROLE',
      'AGENT_GATEWAY_LOG_LEVEL',
    ]);
    const env = source.server.mcp_config.env;
    for (const [k, v] of Object.entries(env)) {
      assert.ok(allowed.has(k), k);
      assert.match(v, /^\$\{user_config\.\w+\}$/);
    }
    for (const [name, opt] of Object.entries(source.user_config)) {
      assert.ok(Object.values(env).includes(`\${user_config.${name}}`), name);
      assert.ok(!opt.sensitive, name);
      assert.ok(['number', 'string'].includes(opt.type));
    }
  });
});

describe('build-mcpb', () => {
  let unpacked;
  before(() => {
    execFileSync('npm', ['run', 'build', '-w', 'gateway'], { cwd: repo, stdio: 'ignore' });
    execFileSync(process.execPath, [path.join(repo, 'scripts/build-mcpb.mjs')], {
      cwd: repo,
      stdio: 'ignore',
    });
    unpacked = path.join(tmp, 'unpacked');
    mkdirSync(unpacked);
    execFileSync(
      path.join(repo, 'node_modules/.bin/mcpb'),
      ['unpack', path.join(repo, 'dist/release/foundry-agent-gateway.mcpb'), unpacked],
      { stdio: 'ignore' },
    );
  });

  it('contains the manifest and its entry point, and the entry runs', () => {
    const manifest = JSON.parse(readFileSync(path.join(unpacked, 'manifest.json'), 'utf8'));
    const entry = path.join(unpacked, manifest.server.entry_point);
    assert.ok(existsSync(entry));
    const home = mkdtempSync(path.join(tmp, 'home-'));
    const out = execFileSync(process.execPath, [entry, '--version'], {
      env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home },
      encoding: 'utf8',
    });
    assert.equal(out.trim(), pkg.version);
  });
});
