// Run by hand: node gateway/test/package/smoke.mjs
// Packs the gateway, installs the tarball into a temp dir with a temp HOME and
// checks the installed bin. Publishes nothing.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const realState = join(homedir(), '.foundry-agent-gateway');
function snapshot(dir) {
  if (!existsSync(dir)) return null;
  const out = [];
  for (const e of readdirSync(dir, { recursive: true }).sort()) {
    const st = statSync(join(dir, e));
    out.push(`${e}:${st.size}:${st.mtimeMs}`);
  }
  return out.join('\n');
}
const before = snapshot(realState);
const work = mkdtempSync(join(tmpdir(), 'fag-smoke-'));
const home = join(work, 'home');
const app = join(work, 'app');
execFileSync('mkdir', ['-p', home, app]);
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  npm_config_cache: join(work, 'cache'),
};

delete env.AGENT_GATEWAY_DB;

try {
  const version = JSON.parse(readFileSync(join(root, 'gateway/package.json'), 'utf8')).version;
  execFileSync('npm', ['pack', '-w', 'gateway', '--pack-destination', work], {
    cwd: root,
    stdio: 'inherit',
  });
  const tgz = join(work, `foundry-agent-gateway-${version}.tgz`);
  assert.ok(existsSync(tgz), 'tarball produced');
  execFileSync('npm', ['init', '-y'], { cwd: app, env, stdio: 'ignore' });
  execFileSync('npm', ['install', tgz], { cwd: app, env, stdio: 'inherit' });

  const v = spawnSync('npx', ['foundry-agent-gateway', '--version'], {
    cwd: app,
    env,
    encoding: 'utf8',
  });
  assert.equal(v.status, 0, v.stderr);
  assert.equal(v.stdout.trim(), version);
  console.log('ok: --version prints', version);

  const init = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '0' },
    },
  });
  const r = spawnSync('npx', ['foundry-agent-gateway'], {
    cwd: app,
    env,
    input: init + '\n',
    encoding: 'utf8',
    timeout: 15000,
  });
  const lines = r.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, `stdout lines: ${JSON.stringify(r.stdout)}`);
  const msg = JSON.parse(lines[0]);
  assert.equal(msg.id, 1);
  assert.ok(msg.result?.serverInfo, 'initialize result');
  console.log('ok: initialize result on stdout, nothing else; stderr bytes:', r.stderr.length);

  const after = snapshot(realState);
  assert.equal(after, before, 'real ~/.foundry-agent-gateway untouched');
  console.log('ok: real state dir untouched');
} finally {
  rmSync(work, { recursive: true, force: true });
}
