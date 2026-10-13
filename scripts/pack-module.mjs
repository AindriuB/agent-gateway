// Writes dist/release/agent-gateway.zip, the file module.json `download` points at.
// Usage: node scripts/pack-module.mjs [--root <dir>]   (root defaults to the repo root)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const i = args.indexOf('--root');
const root = path.resolve(
  i >= 0 ? args[i + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
);

const entry = path.join(root, 'dist/module/main.js');
if (!existsSync(entry)) {
  console.error(`pack-module: missing ${entry}; run npm run build first`);
  process.exit(1);
}

const outDir = path.join(root, 'dist/release');
const out = path.join(outDir, 'agent-gateway.zip');
mkdirSync(outDir, { recursive: true });
rmSync(out, { force: true });

const inputs = ['module.json', 'LICENSE', 'dist/module', 'lang', 'templates', 'styles'];
execFileSync('zip', ['-r', '-q', '-X', out, ...inputs, '-x', '*.ts'], {
  cwd: root,
  stdio: ['ignore', 'ignore', 'inherit'],
});
console.log(out);
