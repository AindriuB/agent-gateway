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

  it('needs no settings: no URL argument, three advanced optional ports and log level', () => {
    assert.deepEqual(source.server.mcp_config.args, ['${__dirname}/dist/bin/cli.js']);
    assert.deepEqual(Object.keys(source.user_config).sort(), [
      'http_port',
      'link_port',
      'log_level',
    ]);
    for (const [name, opt] of Object.entries(source.user_config)) {
      assert.equal(opt.required, false, name);
      assert.notEqual(opt.default, undefined, name);
      assert.ok(opt.description.startsWith('Advanced.'), name);
    }
  });

  it('names no retired setting anywhere', () => {
    const strings = [];
    const walk = (v) => {
      if (typeof v === 'string') strings.push(v);
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          strings.push(k);
          walk(x);
        }
      }
    };
    walk(source);
    for (const s of strings)
      for (const banned of ['foundry_url', 'role', 'allow-origin'])
        assert.ok(!s.includes(banned), `${banned} in ${s}`);
  });

  it('exposes only known env settings and no secrets', () => {
    const allowed = new Set([
      'AGENT_GATEWAY_LINK_PORT',
      'AGENT_GATEWAY_HTTP_PORT',
      'AGENT_GATEWAY_LOG_LEVEL',
    ]);
    const env = source.server.mcp_config.env;
    assert.deepEqual(new Set(Object.keys(env)), allowed);
    for (const [k, v] of Object.entries(env)) {
      assert.ok(allowed.has(k), k);
      assert.match(v, /^\$\{user_config\.\w+\}$/);
    }
    for (const [name, opt] of Object.entries(source.user_config)) {
      const wired = [...Object.values(env), ...source.server.mcp_config.args].join(' ');
      assert.ok(wired.includes(`\${user_config.${name}}`), name);
      assert.ok(!opt.sensitive, name);
      assert.ok(['number', 'string'].includes(opt.type));
    }
  });
});

describe('build-mcpb', () => {
  let unpacked;
  before(() => {
    execFileSync('npm', ['run', 'build', '-w', 'gateway'], { cwd: repo, stdio: 'ignore' });
    const bundle = path.join(tmp, 'out/foundry-agent-gateway.mcpb');
    execFileSync(
      process.execPath,
      [
        path.join(repo, 'scripts/build-mcpb.mjs'),
        '--out',
        bundle,
        '--stage',
        path.join(tmp, 'stage'),
      ],
      { cwd: repo, stdio: 'ignore' },
    );
    unpacked = path.join(tmp, 'unpacked');
    mkdirSync(unpacked);
    execFileSync(path.join(repo, 'node_modules/.bin/mcpb'), ['unpack', bundle, unpacked], {
      stdio: 'ignore',
    });
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

  it('ships notices naming every inlined package', () => {
    const notices = readFileSync(path.join(unpacked, 'THIRD_PARTY_NOTICES'), 'utf8');
    for (const name of [
      '@modelcontextprotocol/sdk',
      'ajv',
      'ajv-formats',
      'fast-deep-equal',
      'fast-uri',
      'json-schema-traverse',
      'ws',
      'zod',
      'zod-to-json-schema',
    ]) {
      assert.ok(notices.includes(`\n${name}@`) || notices.startsWith(`${name}@`), name);
    }
  });
});
