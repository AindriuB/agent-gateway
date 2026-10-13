// Sets one version everywhere: node scripts/bump-version.mjs <version> [--root <dir>]
// Checks they agree:            node scripts/bump-version.mjs --check [<version>] [--root <dir>]
// Edits text in place so the formatting of each file is kept.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE =
  'bump-version: usage: node scripts/bump-version.mjs <version> | --check [<version>] [--root <dir>]';
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const args = process.argv.slice(2);
let root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rest = [];
let check = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root') {
    if (args[i + 1] === undefined) fail(USAGE);
    root = path.resolve(args[++i]);
  } else if (args[i] === '--check') check = true;
  else rest.push(args[i]);
}
const wanted = rest[0];
if (rest.length > 1 || (!check && !wanted)) fail(USAGE);
if (wanted !== undefined && !SEMVER.test(wanted)) fail(`bump-version: not a version: ${wanted}`);

// Each target: file, a regex with group 1 = text before the version, group 2 = the version,
// group 3 = text after it, and a label.
const pkgVersion = /^(\{[^]*?\n {2}"version": ")([^"]*)(")/;
const lockEntry = (key) =>
  new RegExp(`(\\n {4}"${key}": \\{\\n(?: {6}"name": "[^"]*",\\n)? {6}"version": ")([^"]*)(")`);
const targets = [
  ['package.json', pkgVersion, 'root package.json'],
  ['protocol/package.json', pkgVersion, 'protocol package.json'],
  ['module/package.json', pkgVersion, 'module package.json'],
  ['gateway/package.json', pkgVersion, 'gateway package.json'],
  [
    'package-lock.json',
    /^(\{\n {2}"name": "[^"]*",\n {2}"version": ")([^"]*)(")/,
    'package-lock.json',
  ],
  ...['', 'protocol', 'module', 'gateway'].map((k) => [
    'package-lock.json',
    lockEntry(k),
    `package-lock.json packages["${k}"]`,
  ]),
  ['module.json', pkgVersion, 'module.json version'],
  [
    'module.json',
    /(\n {2}"download": "[^"]*\/releases\/download\/v)([^/"]*)(\/[^"]*")/,
    'module.json download tag',
  ],
  ['gateway/mcpb/manifest.json', pkgVersion, 'gateway/mcpb/manifest.json'],
];

const texts = new Map();
const read = (f) => {
  if (!texts.has(f)) texts.set(f, readFileSync(path.join(root, f), 'utf8'));
  return texts.get(f);
};

const found = [];
for (const [file, re, label] of targets) {
  const m = re.exec(read(file));
  if (!m) fail(`bump-version: no version found in ${label}`);
  found.push({ file, re, label, version: m[2] });
}

if (check) {
  const expect = wanted ?? found[0].version;
  const bad = found.filter((f) => f.version !== expect);
  if (bad.length > 0) {
    for (const b of bad)
      console.error(`bump-version: ${b.label} is ${b.version}, expected ${expect}`);
    process.exit(1);
  }
  console.log(`bump-version: all ${found.length} places agree on ${expect}`);
} else {
  for (const t of found) {
    texts.set(
      t.file,
      read(t.file).replace(t.re, (_m, a, _v, c) => `${a}${wanted}${c}`),
    );
  }
  for (const [f, text] of texts) writeFileSync(path.join(root, f), text);
  console.log(`bump-version: set ${wanted} in ${found.length} places`);
}
