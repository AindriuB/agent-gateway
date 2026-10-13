// Local release: node scripts/release.mjs <version> [--allow-missing-v13] [--publish-npm] [--root <dir>]
// Bumps the version, runs every gate, builds the three artefacts into dist/release/, prints their
// SHA-256, then asks for `yes` before creating a DRAFT GitHub release and a dry-run npm publish.
// It never publishes the draft, never pushes and never tags. See docs/releasing.md.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const USAGE =
  'release: usage: node scripts/release.mjs <version> [--allow-missing-v13] [--publish-npm] [--root <dir>]';
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const PLATFORMS_LINE = 'Platforms: macOS verified; Windows untested in this release';

function die(msg, code = 1) {
  console.error(`release: ${msg}`);
  process.exit(code);
}

const args = process.argv.slice(2);
let root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let allowMissingV13 = false;
let publishNpm = false;
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--root') {
    if (args[i + 1] === undefined) die(USAGE.slice(9));
    root = path.resolve(args[++i]);
  } else if (a === '--allow-missing-v13') allowMissingV13 = true;
  else if (a === '--publish-npm') publishNpm = true;
  else if (a.startsWith('--')) die(USAGE.slice(9));
  else positional.push(a);
}
if (positional.length !== 1) die(USAGE.slice(9));
const version = positional[0];
if (!SEMVER.test(version)) die(`not a version: ${version}`);

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8', ...opts });
  if (r.error) die(`could not run ${cmd}: ${r.error.message}`);
  return r;
}

// 1. Clean tree on main.
const status = run('git', ['status', '--porcelain']);
if (status.status !== 0) die('not a git repository');
if (status.stdout.trim() !== '')
  die('the working tree is not clean; commit or remove changes first');
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
if (branch !== 'main') die(`must be on main, not ${branch}`);

// 2. One version everywhere.
const bump = run('node', [path.join(root, 'scripts/bump-version.mjs'), version, '--root', root], {
  stdio: 'inherit',
});
if (bump.status !== 0) die('bump-version failed');

// 3. Gates, in order.
const notes = [];
function gate(name, npmArgs, ok) {
  console.log(`\n== gate: ${name} ==`);
  const r = run('npm', npmArgs);
  process.stdout.write(r.stdout ?? '');
  process.stderr.write(r.stderr ?? '');
  if (r.status !== 0) die(`gate failed: ${name}`);
  if (ok && !ok(r.stdout ?? '')) die(`gate failed: ${name} (expected output missing)`);
}
gate('verify', ['run', 'verify']);
gate('test:scripts', ['run', 'test:scripts']);
gate('test:conformance', ['run', 'test:conformance'], (out) =>
  /^conformance: ok \(inspector [^)\s,]+, stdio, http\)$/m.test(out),
);
gate('e2e v14', ['run', 'test:e2e', '--', '--foundry', 'v14']);
console.log('\n== gate: e2e v13 ==');
{
  const r = run('npm', ['run', 'test:e2e', '--', '--foundry', 'v13']);
  process.stdout.write(r.stdout ?? '');
  process.stderr.write(r.stderr ?? '');
  if (r.status !== 0) die('gate failed: e2e v13');
  if (/^SKIP:/m.test(r.stdout ?? '')) {
    if (!allowMissingV13) die('gate failed: v13 was skipped (pass --allow-missing-v13 to accept)');
    notes.push('v13 e2e gate was SKIPPED (--allow-missing-v13)');
  }
}

// 4. Artefacts.
const outDir = path.join(root, 'dist/release');
mkdirSync(outDir, { recursive: true });
const steps = [
  ['pack-module', 'node', [path.join(root, 'scripts/pack-module.mjs'), '--root', root]],
  ['npm pack', 'npm', ['pack', '-w', 'gateway', '--pack-destination', outDir]],
  ['build-mcpb', 'node', [path.join(root, 'scripts/build-mcpb.mjs'), '--root', root]],
];
for (const [name, cmd, a] of steps) {
  const r = run(cmd, a, { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) die(`${name} failed`);
}
const zip = path.join(outDir, 'agent-gateway.zip');
const tgz = path.join(outDir, `foundry-agent-gateway-${version}.tgz`);
const mcpb = path.join(outDir, 'foundry-agent-gateway.mcpb');
console.log('\nArtefacts:');
for (const f of [zip, tgz, mcpb]) {
  if (!existsSync(f)) die(`missing artefact ${f}`);
  const sha = createHash('sha256').update(readFileSync(f)).digest('hex');
  console.log(`  ${sha}  ${path.relative(root, f)}`);
}

// 5. Plan and confirmation.
function checklist() {
  const file = path.join(root, 'docs/releasing.md');
  if (!existsSync(file)) return { answered: 0, total: 6 };
  const text = readFileSync(file, 'utf8');
  const at = text.search(/^#+\s*Before Foundry submission\s*$/m);
  const section = at < 0 ? '' : text.slice(at);
  const next = section.slice(1).search(/^## /m);
  const body = next < 0 ? section : section.slice(0, next + 1);
  const answered = (body.match(/^- Answer:[ \t]*\S.*$/gm) ?? []).length;
  return { answered: Math.min(answered, 6), total: 6 };
}
const { answered, total } = checklist();
const notesFile = path.join(outDir, 'release-notes.md');
writeFileSync(
  notesFile,
  `# Agent Gateway ${version}\n\n${PLATFORMS_LINE}\n\nDraft release; see docs/releasing.md before publishing.\n`,
);
const plan = [
  `gh release create v${version} --draft (zip, module.json, .mcpb)`,
  'npm publish -w gateway --dry-run',
  publishNpm
    ? `npm publish -w gateway (real; needs a second confirmation)`
    : 'no real npm publish (pass --publish-npm to enable)',
];
console.log('\nPlanned actions:');
for (const p of plan) console.log(`  - ${p}`);
for (const n of notes) console.log(`  ! ${n}`);
console.log(`Ask Foundry checklist: ${answered} of ${total} answered`);

const rl = createInterface({ input: process.stdin });
const lines = rl[Symbol.asyncIterator]();
async function ask(prompt) {
  process.stdout.write(prompt);
  const { value, done } = await lines.next();
  return done ? '' : String(value).trim();
}
const finish = (code) => {
  rl.close();
  process.exit(code);
};

if ((await ask('Type yes to create the draft release: ')) !== 'yes') {
  console.log('\nNothing uploaded.');
  finish(0);
}

// 6. Upload (draft only).
const gh = run(
  'gh',
  [
    'release',
    'create',
    `v${version}`,
    '--draft',
    '--title',
    `Agent Gateway ${version}`,
    '--notes-file',
    notesFile,
    zip,
    path.join(root, 'module.json'),
    mcpb,
  ],
  { stdio: 'inherit' },
);
if (gh.status !== 0) die('gh release create failed');
const dry = run('npm', ['publish', '-w', 'gateway', '--dry-run'], { stdio: 'inherit' });
if (dry.status !== 0) die('npm publish --dry-run failed');

if (publishNpm) {
  const want = `publish foundry-agent-gateway@${version}`;
  if ((await ask(`Type "${want}" to publish to npm: `)) === want) {
    const pub = run('npm', ['publish', '-w', 'gateway'], { stdio: 'inherit' });
    if (pub.status !== 0) die('npm publish failed');
  } else {
    console.log('\nnpm publish not confirmed; skipped.');
  }
}

console.log('\nSummary:');
console.log(`  version: ${version}`);
console.log(`  draft release v${version} created; NOT published`);
console.log(`  v13 e2e: ${notes.length > 0 ? 'SKIPPED (--allow-missing-v13)' : 'passed'}`);
console.log(`  Ask Foundry checklist: ${answered} of ${total} answered`);
console.log('  The version bump is uncommitted in this tree; open a PR for it.');
finish(0);
