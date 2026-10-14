// Writes dist/release/agent-gateway.zip, the file module.json `download` points at.
// Usage: node scripts/pack-module.mjs [--root <dir>] [--base-url <https-url>]   (root defaults to the repo root)
// With --base-url, the packed module.json (zip and dist/release/module.json) points manifest and
// download at <base-url>/module.json and <base-url>/agent-gateway.zip, for self-hosting.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const usage =
  'pack-module: usage: node scripts/pack-module.mjs [--root <dir>] [--base-url <https-url>]';
const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  if (args[i + 1] === undefined || args[i + 1].startsWith('--')) {
    console.error(usage);
    process.exit(1);
  }
  return args[i + 1];
}
const rootArg = flag('--root');
const baseArg = flag('--base-url');
const root = path.resolve(rootArg ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

let base;
if (baseArg !== undefined) {
  let u;
  try {
    u = new URL(baseArg);
  } catch {
    u = undefined;
  }
  if (!u || u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) {
    console.error(
      'pack-module: --base-url must be an https URL without credentials, query or fragment',
    );
    process.exit(1);
  }
  base = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

const entry = path.join(root, 'dist/module/main.js');
if (!existsSync(entry)) {
  console.error(`pack-module: missing ${entry}; run npm run build first`);
  process.exit(1);
}

const outDir = path.join(root, 'dist/release');
const out = path.join(outDir, 'agent-gateway.zip');
mkdirSync(outDir, { recursive: true });
rmSync(out, { force: true });
const selfManifest = path.join(outDir, 'module.json');
rmSync(selfManifest, { force: true });

const inputs = [
  ...(base ? [] : ['module.json']),
  'LICENSE',
  'dist/module',
  'lang',
  'templates',
  'styles',
];
// Excluded: TypeScript, source maps (they embed the full source), and any dotfile or dot directory.
const excludes = ['*.ts', '*.map', '.*', '*/.*'];
try {
  execFileSync('zip', ['-r', '-q', '-X', out, ...inputs, '-x', ...excludes], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
} catch (err) {
  const why = err.code === 'ENOENT' ? 'zip is not installed' : `zip failed (${err.status})`;
  console.error(`pack-module: ${why}`);
  process.exit(1);
}
if (base) {
  const m = JSON.parse(readFileSync(path.join(root, 'module.json'), 'utf8'));
  m.manifest = `${base}/module.json`;
  m.download = `${base}/agent-gateway.zip`;
  writeFileSync(selfManifest, JSON.stringify(m, null, 2) + '\n');
  try {
    execFileSync('zip', ['-q', '-X', '-j', out, selfManifest], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (err) {
    console.error(`pack-module: zip failed (${err.status})`);
    process.exit(1);
  }
}
console.log(out);
if (base) console.log(selfManifest);
