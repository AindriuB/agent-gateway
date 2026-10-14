import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pluginDir = path.join(repo, 'plugins/claude/foundry-gateway');
const marketplacePath = path.join(repo, '.claude-plugin/marketplace.json');
const manifestPath = path.join(pluginDir, '.claude-plugin/plugin.json');
const mcpPath = path.join(pluginDir, '.mcp.json');
const skillPath = path.join(pluginDir, 'skills/foundry-gateway/SKILL.md');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const hasClaude =
  spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 15_000 }).status === 0;

describe('claude plugin files', () => {
  it('parse as JSON', () => {
    for (const p of [manifestPath, mcpPath, marketplacePath])
      assert.doesNotThrow(() => readJson(p), p);
  });

  it('plugin.json has a version equal to the root package version and no inline server', () => {
    const m = readJson(manifestPath);
    assert.equal(m.version, readJson(path.join(repo, 'package.json')).version);
    assert.ok(!('mcpServers' in m));
    assert.ok(!('userConfig' in m));
  });

  it('plugin name is kebab-case and not reserved', () => {
    const { name } = readJson(manifestPath);
    assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    for (const prefix of ['claude-', 'anthropic-', 'anthropics-', 'cc-plugin-']) {
      assert.ok(!name.startsWith(prefix), prefix);
    }
  });

  it('marketplace entry matches the plugin', () => {
    const market = readJson(marketplacePath);
    assert.equal(market.name, 'agent-gateway');
    assert.ok(market.owner.name);
    assert.ok(!('version' in market.plugins[0]));
    assert.equal(market.plugins.length, 1);
    const [entry] = market.plugins;
    assert.equal(entry.name, readJson(manifestPath).name);
    assert.equal(path.resolve(repo, entry.source), pluginDir);
    assert.ok(
      existsSync(path.join(path.resolve(repo, entry.source), '.claude-plugin/plugin.json')),
    );
  });

  it('.mcp.json is one OAuth-discovered http server', () => {
    const mcp = readJson(mcpPath);
    assert.deepEqual(Object.keys(mcp), ['mcpServers']);
    assert.deepEqual(Object.keys(mcp.mcpServers), ['agent-gateway']);
    assert.deepEqual(mcp.mcpServers['agent-gateway'], {
      type: 'http',
      url: '${AGENT_GATEWAY_URL:-https://gw.aindriub.app}/mcp',
    });
    const text = readFileSync(mcpPath, 'utf8');
    for (const key of ['headers', 'oauth', 'env', 'clientId', 'client_id', 'client_secret']) {
      assert.ok(!text.includes(`"${key}"`), key);
    }
  });

  it('contains no secret-looking strings', () => {
    const files = [...walk(pluginDir), ...walk(path.join(repo, '.claude-plugin'))];
    assert.ok(files.length >= 4);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      assert.doesNotMatch(text, /Bearer |Authorization|secret|token=|password/i, f);
    }
  });

  it('SKILL.md has a name and description in its frontmatter', () => {
    const m = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(skillPath, 'utf8'));
    assert.ok(m, 'frontmatter');
    assert.match(m[1], /^name: foundry-gateway$/m);
    assert.match(m[1], /^description: \S.+$/m);
  });
});

describe('claude plugin validate', () => {
  for (const [label, target] of [
    ['plugin', pluginDir],
    ['marketplace', repo],
  ]) {
    it(`${label} passes claude plugin validate --strict`, (t) => {
      if (!hasClaude) return t.skip('claude CLI not found');
      const r = spawnSync('claude', ['plugin', 'validate', target, '--strict'], {
        encoding: 'utf8',
        timeout: 60_000,
      });
      assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    });
  }
});
