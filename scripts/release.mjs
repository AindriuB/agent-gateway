// Local release: node scripts/release.mjs <version> [--allow-missing-v13] [--allow-skipped-image] [--publish-npm] [--push-image] [--root <dir>]
// Bumps the version, runs every gate, builds the three artefacts into dist/release/, prints their
// SHA-256, then asks for `yes` before creating a DRAFT GitHub release and a dry-run npm publish.
// It never publishes the draft, never pushes and never tags. See docs/releasing.md.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const USAGE =
  'release: usage: node scripts/release.mjs <version> [--allow-missing-v13] [--allow-skipped-image] [--publish-npm] [--push-image] [--root <dir>]';
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
// Same text as V13_SKIP_MESSAGE in e2e/lib/args.ts (a test keeps them equal); other SKIP: lines are fine.
const V13_SKIP_MESSAGE = 'SKIP: v13 instance not configured (set AGENT_GATEWAY_E2E_V13_URL)';
const PLATFORMS_LINE = 'Platforms: macOS verified; Windows untested in this release';

function die(msg, code = 1) {
  console.error(`release: ${msg}`);
  process.exit(code);
}

const args = process.argv.slice(2);
let root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let allowMissingV13 = false;
let allowSkippedImage = false;
let publishNpm = false;
let pushImage = false;
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--root') {
    if (args[i + 1] === undefined) die(USAGE.slice(9));
    root = path.resolve(args[++i]);
  } else if (a === '--allow-missing-v13') allowMissingV13 = true;
  else if (a === '--allow-skipped-image') allowSkippedImage = true;
  else if (a === '--publish-npm') publishNpm = true;
  else if (a === '--push-image') pushImage = true;
  else if (a.startsWith('--')) die(USAGE.slice(9));
  else positional.push(a);
}
if (positional.length !== 1) die(USAGE.slice(9));
const version = positional[0];
if (!SEMVER.test(version)) die(`not a version: ${version}`);
// No registry is chosen yet (GHCR or Docker Hub), so there is nowhere to push the image.
if (pushImage) die('registry not configured; --push-image cannot push yet');

// The e2e gates' environment. Same precedence as e2e/lib/config.ts: process environment first, then
// ~/.config/agent-gateway/test.env; an empty value counts as unset. Only URLs and paths are ever printed.
function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value[0] === value.at(-1) && (value[0] === '"' || value[0] === "'"))
      value = value.slice(1, -1);
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}
const home = homedir();
const configDir = path.join(home, '.config/agent-gateway');
const testEnvPath = path.join(configDir, 'test.env');
const testEnv = existsSync(testEnvPath) ? parseEnvFile(readFileSync(testEnvPath, 'utf8')) : {};
const setting = (key) => (process.env[key] ? process.env[key] : testEnv[key] || undefined);
const expandHome = (p) => (p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : p);
const v13Url = setting('AGENT_GATEWAY_E2E_V13_URL')?.replace(/\/+$/, '') || undefined;
const v14Url = setting('FOUNDRY_URL')?.replace(/\/+$/, '') || 'https://foundry.local';
const v13State = expandHome(
  setting('AGENT_GATEWAY_E2E_V13_STATE_DIR') ?? path.join(configDir, 'e2e-v13'),
);
if (!path.isAbsolute(v13State)) die('AGENT_GATEWAY_E2E_V13_STATE_DIR must be an absolute path');
const v14State = process.env.AGENT_GATEWAY_E2E_STATE_DIR
  ? expandHome(process.env.AGENT_GATEWAY_E2E_STATE_DIR)
  : path.join(configDir, 'e2e');
if (path.resolve(v14State) === path.resolve(v13State))
  die(`v14 and v13 e2e state directories are the same: ${v13State}`);

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
// Only scheme://host[:port]/path is ever printed: userinfo, query and fragment are dropped.
function shown(u) {
  try {
    const x = new URL(u);
    return `${x.protocol}//${x.host}${x.pathname}`.replace(/\/+$/, '');
  } catch {
    return '<unparseable url>';
  }
}
// The native image suites are opt-in; both e2e gates switch them on, and a suite that printed no
// summary line or passed nothing counts as skipped.
const IMAGE_ENV = { AGENT_GATEWAY_E2E_IMAGE: '1', AGENT_GATEWAY_E2E_UPLOAD: '1' };
const IMAGE_SUITES = ['upload', 'image-assign', 'image-view'];
const imageSkips = [];
function checkImageSuites(gateName, out) {
  const passed = new Map();
  for (const l of out.split('\n')) {
    const m =
      /^ {2}(upload|image-assign|image-view): (\d+) passed, (\d+) failed, (\d+) skipped$/.exec(l);
    if (m) passed.set(m[1], Number(m[2]));
  }
  const missing = IMAGE_SUITES.filter((s) => !(passed.get(s) > 0));
  if (missing.length === 0) return;
  const names = missing.join(', ');
  if (!allowSkippedImage) die(`gate failed: ${gateName} image suites skipped: ${names}`);
  notes.push(`${gateName} image suites SKIPPED: ${names} (--allow-skipped-image)`);
  imageSkips.push(`${gateName.replace(/^e2e /, '')}: ${names}`);
}
function gate(name, npmArgs, ok, info, opts) {
  console.log(`\n== gate: ${name} ==`);
  if (info) console.log(info);
  const r = run('npm', npmArgs, opts);
  process.stdout.write(r.stdout ?? '');
  process.stderr.write(r.stderr ?? '');
  if (r.status !== 0) die(`gate failed: ${name}`);
  if (ok && !ok(r.stdout ?? '')) die(`gate failed: ${name} (expected output missing)`);
  if (name === 'e2e v14') checkImageSuites(name, r.stdout ?? '');
}
gate('verify', ['run', 'verify']);
gate('test:scripts', ['run', 'test:scripts']);
gate('test:conformance', ['run', 'test:conformance'], (out) =>
  /^conformance: ok \(inspector [^)\s,]+, stdio, http, oauth\)$/m.test(out),
);
gate(
  'e2e v14',
  ['run', 'test:e2e', '--', '--foundry', 'v14'],
  undefined,
  `e2e v14: url ${shown(v14Url)}, state ${v14State}`,
  { env: { ...process.env, ...IMAGE_ENV } },
);
console.log('\n== gate: e2e v13 ==');
console.log(`e2e v13: url ${v13Url ? shown(v13Url) : 'not set'}, state ${v13State}`);
let v13Ran = true;
{
  const r = run('npm', ['run', 'test:e2e', '--', '--foundry', 'v13'], {
    env: {
      ...process.env,
      ...IMAGE_ENV,
      AGENT_GATEWAY_E2E_STATE_DIR: v13State,
      ...(v13Url ? { AGENT_GATEWAY_E2E_V13_URL: v13Url } : {}),
    },
  });
  process.stdout.write(r.stdout ?? '');
  process.stderr.write(r.stderr ?? '');
  if (r.status !== 0) die('gate failed: e2e v13');
  if ((r.stdout ?? '').split('\n').some((l) => l.startsWith(V13_SKIP_MESSAGE))) {
    if (!allowMissingV13) die('gate failed: v13 was skipped (pass --allow-missing-v13 to accept)');
    notes.push('v13 e2e gate was SKIPPED (--allow-missing-v13)');
    v13Ran = false;
  }
  if (v13Ran) checkImageSuites('e2e v13', r.stdout ?? '');
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
// The server-mode image is built and tagged locally only; nothing is pushed.
const imageTag = `foundry-agent-gateway:${version}`;
if (existsSync(path.join(root, 'gateway/Dockerfile'))) {
  const r = run('docker', ['build', '-f', 'gateway/Dockerfile', '-t', imageTag, '.'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  if (r.status !== 0) die('docker build failed');
}
console.log('\nArtefacts:');
for (const f of [zip, tgz, mcpb]) {
  if (!existsSync(f)) die(`missing artefact ${f}`);
  const sha = createHash('sha256').update(readFileSync(f)).digest('hex');
  console.log(`  ${sha}  ${path.relative(root, f)}`);
}
if (existsSync(path.join(root, 'gateway/Dockerfile')))
  console.log(`  image ${imageTag} (local only, not pushed)`);

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
const v13Summary = !v13Ran ? 'SKIPPED (--allow-missing-v13)' : `passed (${shown(v13Url)})`;
console.log(`  v13 e2e: ${v13Summary}`);
console.log(
  imageSkips.length > 0
    ? `  image e2e: SKIPPED (${imageSkips.join('; ')})`
    : `  image e2e: ran (${v13Ran ? 'v14, v13' : 'v14'})`,
);
console.log(`  Ask Foundry checklist: ${answered} of ${total} answered`);
console.log('  The version bump is uncommitted in this tree; open a PR for it.');
finish(0);
