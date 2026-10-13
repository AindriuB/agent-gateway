// Writes dist/release/foundry-agent-gateway.mcpb from the gateway build (gateway/dist/bin/cli.js).
// Usage: node scripts/build-mcpb.mjs [--root <dir>]   (root defaults to the repo root)
// The gateway's npm dependencies are inlined so the bundle needs no node_modules.
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const args = process.argv.slice(2);
const i = args.indexOf('--root');
if (i >= 0 && (args[i + 1] === undefined || args[i + 1].startsWith('--'))) {
  console.error('build-mcpb: usage: node scripts/build-mcpb.mjs [--root <dir>]');
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(i >= 0 ? args[i + 1] : path.join(here, '..'));

const cli = path.join(root, 'gateway/dist/bin/cli.js');
if (!existsSync(cli)) {
  console.error(`build-mcpb: missing ${cli}; run npm run build first`);
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(path.join(root, 'gateway/package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(path.join(root, 'gateway/mcpb/manifest.json'), 'utf8'));
if (manifest.version !== pkg.version) {
  console.error(`build-mcpb: manifest version ${manifest.version} != gateway ${pkg.version}`);
  process.exit(1);
}

const stage = path.join(root, 'dist/mcpb-stage');
const outDir = path.join(root, 'dist/release');
const out = path.join(outDir, 'foundry-agent-gateway.mcpb');
rmSync(stage, { recursive: true, force: true });
mkdirSync(path.join(stage, 'dist/bin'), { recursive: true });
mkdirSync(outDir, { recursive: true });
rmSync(out, { force: true });

const entry = path.join(stage, 'dist/bin/cli.js');
await build({
  entryPoints: [cli],
  outfile: entry,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'warning',
});
chmodSync(entry, 0o755);
// cli.js reads ../../package.json for --version.
writeFileSync(
  path.join(stage, 'package.json'),
  JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module' }, null, 2) + '\n',
);
cpSync(path.join(root, 'gateway/mcpb/manifest.json'), path.join(stage, 'manifest.json'));
if (existsSync(path.join(root, 'LICENSE')))
  cpSync(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE'));

const mcpb = path.join(root, 'node_modules/.bin/mcpb');
execFileSync(existsSync(mcpb) ? mcpb : 'mcpb', ['pack', stage, out], {
  stdio: ['ignore', 'inherit', 'inherit'],
});
rmSync(stage, { recursive: true, force: true });
console.log(`build-mcpb: wrote ${out}`);
