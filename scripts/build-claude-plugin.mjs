// Builds the hosted Claude Code marketplace: dist/release/claude/marketplace.json plus
// dist/release/claude/plugins/foundry-gateway-<version>.zip, for upload under <base-url>.
// Usage: node scripts/build-claude-plugin.mjs --base-url <https-url> [--gateway-url <https-url>] [--root <dir>]   (root defaults to the repo root)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const usage =
  'build-claude-plugin: usage: node scripts/build-claude-plugin.mjs --base-url <https-url> [--gateway-url <https-url>] [--root <dir>]';
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  if (args[i + 1] === undefined || args[i + 1].startsWith('--')) fail(usage);
  return args[i + 1];
}
const rootArg = flag('--root');
const baseArg = flag('--base-url');
if (baseArg === undefined) fail(usage);
const gatewayArg = flag('--gateway-url');
const root = path.resolve(rootArg ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

let u;
try {
  u = new URL(baseArg);
} catch {
  u = undefined;
}
if (!u || u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) {
  fail(
    'build-claude-plugin: --base-url must be an https URL without credentials, query or fragment',
  );
}
const base = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;

let gatewayMcpUrl;
if (gatewayArg !== undefined) {
  let g;
  try {
    g = new URL(gatewayArg);
  } catch {
    g = undefined;
  }
  if (!g || g.protocol !== 'https:' || g.username || g.password || g.search || g.hash) {
    fail(
      'build-claude-plugin: --gateway-url must be an https URL without credentials, query or fragment',
    );
  }
  if (/\/mcp\/*$/.test(g.pathname)) {
    fail('build-claude-plugin: --gateway-url must not end in /mcp; the build appends it');
  }
  gatewayMcpUrl = `${g.origin}${g.pathname.replace(/\/+$/, '')}/mcp`;
}

const MAX_MARKETPLACE = 5 * 1024 * 1024;
const MAX_ZIP = 256 * 1024 * 1024;
const pluginRel = 'plugins/claude/foundry-gateway';
const files = ['.claude-plugin/plugin.json', '.mcp.json', 'skills/foundry-gateway/SKILL.md'];
let pluginReal;
try {
  pluginReal = realpathSync(path.join(root, pluginRel));
} catch {
  fail(`build-claude-plugin: missing ${pluginRel}`);
}
for (const f of files) {
  let st;
  let real;
  try {
    st = lstatSync(path.join(root, pluginRel, f));
    real = realpathSync(path.join(root, pluginRel, f));
  } catch {
    st = undefined;
  }
  if (!st?.isFile() || !real.startsWith(pluginReal + path.sep)) {
    fail(`build-claude-plugin: ${f} must be a regular file inside ${pluginRel}`);
  }
}
const manifest = JSON.parse(readFileSync(path.join(root, pluginRel, files[0]), 'utf8'));
const { name, version, description } = manifest;
if (name !== 'foundry-gateway' || !version)
  fail('build-claude-plugin: plugin.json needs name foundry-gateway and a version');

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail('build-claude-plugin: plugin.json version is not a semver version');
}
const outDir = path.join(root, 'dist/release/claude');
const zipPath = path.join(outDir, 'plugins', `${name}-${version}.zip`);
const marketPath = path.join(outDir, 'marketplace.json');
let zipError;
const stage = mkdtempSync(path.join(tmpdir(), 'build-claude-plugin-'));
try {
  for (const f of files) {
    const dest = path.join(stage, name, f);
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(path.join(root, pluginRel, f), dest);
    if (f === '.mcp.json' && gatewayMcpUrl !== undefined) {
      const mcp = JSON.parse(readFileSync(dest, 'utf8'));
      for (const server of Object.values(mcp.mcpServers)) server.url = gatewayMcpUrl;
      writeFileSync(dest, JSON.stringify(mcp, null, 2) + '\n');
    }
  }
  mkdirSync(path.dirname(zipPath), { recursive: true });
  rmSync(zipPath, { force: true });
  try {
    execFileSync('zip', ['-r', '-q', '-X', zipPath, name], {
      cwd: stage,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (err) {
    zipError = err.code === 'ENOENT' ? 'zip is not installed' : `zip failed (${err.status})`;
  }
} finally {
  rmSync(stage, { recursive: true, force: true });
}
if (zipError) fail(`build-claude-plugin: ${zipError}`);
if (statSync(zipPath).size > MAX_ZIP) {
  rmSync(zipPath, { force: true });
  fail('build-claude-plugin: zip exceeds 256 MiB');
}
const sha256 = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
const market =
  JSON.stringify(
    {
      name: 'aindriub-dl',
      description: 'Hosted marketplace for the agent-gateway Foundry VTT plugin.',
      owner: { name: 'AindriuB' },
      plugins: [
        {
          name,
          description,
          source: { source: 'archive', url: `${base}/plugins/${name}-${version}.zip`, sha256 },
        },
      ],
    },
    null,
    2,
  ) + '\n';
if (Buffer.byteLength(market) > MAX_MARKETPLACE) {
  rmSync(zipPath, { force: true });
  fail('build-claude-plugin: marketplace.json exceeds 5 MiB');
}
writeFileSync(marketPath, market);
console.log(zipPath);
console.log(marketPath);
console.log(sha256);
