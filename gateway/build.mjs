// Bundles the CLI into dist/bin/cli.js, inlining the private
// @agent-gateway/protocol workspace so the published package has no
// workspace dependency. Real dependencies stay external.
import { chmodSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const cli = here('./dist/bin/cli.js');

const pkg = JSON.parse(readFileSync(here('./package.json'), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter(
  (n) => !n.startsWith('@agent-gateway/'),
);

rmSync(here('./dist'), { recursive: true, force: true });
await build({
  entryPoints: [here('./src/bin/cli.ts')],
  outfile: cli,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  external: [...external, ...external.map((n) => `${n}/*`)],
  logLevel: 'warning',
});
chmodSync(cli, 0o755);
