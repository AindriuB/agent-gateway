// Writes dist/release/foundry-agent-gateway.mcpb from the gateway build (gateway/dist/bin/cli.js).
// Usage: node scripts/build-mcpb.mjs [--root <dir>] [--out <file>] [--stage <dir>]
// The gateway's npm dependencies are inlined so the bundle needs no node_modules.
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE =
  'build-mcpb: usage: node scripts/build-mcpb.mjs [--root <dir>] [--out <file>] [--stage <dir>]';
const args = process.argv.slice(2);
function opt(name) {
  const k = args.indexOf(name);
  if (k < 0) return undefined;
  if (args[k + 1] === undefined || args[k + 1].startsWith('--')) {
    console.error(USAGE);
    process.exit(1);
  }
  return args[k + 1];
}
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(opt('--root') ?? path.join(here, '..'));
const out = path.resolve(
  opt('--out') ?? path.join(root, 'dist/release/foundry-agent-gateway.mcpb'),
);
const stage = path.resolve(opt('--stage') ?? path.join(root, 'dist/mcpb-stage'));
// esbuild is a gateway devDependency; resolve it from the gateway workspace, not root hoisting.
const { build } = createRequire(path.join(root, 'gateway/package.json'))('esbuild');

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

rmSync(stage, { recursive: true, force: true });
mkdirSync(path.join(stage, 'dist/bin'), { recursive: true });
mkdirSync(path.dirname(out), { recursive: true });
rmSync(out, { force: true });

const entry = path.join(stage, 'dist/bin/cli.js');
const result = await build({
  absWorkingDir: root,
  metafile: true,
  external: ['bufferutil', 'utf-8-validate'],
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
writeFileSync(path.join(stage, 'THIRD_PARTY_NOTICES'), notices(result.metafile));
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

// One entry per npm package that esbuild inlined, with that package's own license text.
function notices(metafile) {
  const dirs = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const abs = path.resolve(root, input);
    const m = abs.split(path.sep + 'node_modules' + path.sep);
    if (m.length < 2) continue;
    const rest = m[m.length - 1].split(path.sep);
    const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
    dirs.set(
      name,
      abs.slice(0, abs.length - m[m.length - 1].length) + name.split('/').join(path.sep),
    );
  }
  const parts = [];
  for (const name of [...dirs.keys()].sort()) {
    const dir = dirs.get(name);
    const pj = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const file = readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\..*)?$/i.test(f));
    if (!file) throw new Error(`build-mcpb: no license file for inlined package ${name}`);
    parts.push(
      `${name}@${pj.version} (${pj.license ?? 'see below'})\n\n${readFileSync(path.join(dir, file), 'utf8').trim()}\n`,
    );
  }
  return `This bundle includes the following third-party packages.\n\n${parts.join('\n' + '-'.repeat(72) + '\n\n')}`;
}
