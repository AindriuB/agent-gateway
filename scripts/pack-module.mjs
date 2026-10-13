// Writes dist/release/agent-gateway.zip, the file module.json `download` points at.
// Usage: node scripts/pack-module.mjs [--root <dir>]   (root defaults to the repo root)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const i = args.indexOf('--root');
if (i >= 0 && (args[i + 1] === undefined || args[i + 1].startsWith('--'))) {
  console.error('pack-module: usage: node scripts/pack-module.mjs [--root <dir>]');
  process.exit(1);
}
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
console.log(out);
