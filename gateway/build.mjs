// Bundles the CLI into dist/bin/cli.js, inlining the private
// @agent-gateway/protocol workspace so the published package has no
// workspace dependency. Real dependencies stay external.
import { chmodSync, readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((n) => !n.startsWith('@agent-gateway/'));

rmSync(new URL('./dist', import.meta.url), { recursive: true, force: true });
await build({
  entryPoints: [new URL('./src/bin/cli.ts', import.meta.url).pathname],
  outfile: new URL('./dist/bin/cli.js', import.meta.url).pathname,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  external: [...external, ...external.map((n) => `${n}/*`)],
  logLevel: 'warning',
});
chmodSync(new URL('./dist/bin/cli.js', import.meta.url), 0o755);
