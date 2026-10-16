// Package-contract validator v1: intentionally supports only this plugin's small profile.
// Usage: node scripts/build-chatgpt-plugin.mjs [--gateway-url <https-url>] [--root <repository>]
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const name = 'foundry-agent-gateway';
const skillPath = 'skills/foundry-workflow/SKILL.md';
const schemaRoot = 'https://agent-plugins.org/schemas/1.0.0/';

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

function keys(value, expected, label) {
  requireThat(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    `${label}: expected object`,
  );
  requireThat(
    Object.keys(value).sort().join(',') === [...expected].sort().join(','),
    `${label}: missing or unsupported fields`,
  );
}

function text(value, label) {
  requireThat(
    typeof value === 'string' && value.trim().length > 0,
    `${label}: expected nonempty text`,
  );
}

// Check every path component, not only the leaf. Never follow a package or output symlink.
function regularPath(root, relative, leafType, allowMissing = false) {
  const parts = relative.split('/');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error.code === 'ENOENT' && allowMissing) continue;
      throw new Error(`missing ${relative}`);
    }
    requireThat(!stat.isSymbolicLink(), `symlink is not allowed: ${relative}`);
    requireThat(
      i === parts.length - 1 && leafType === 'file' ? stat.isFile() : stat.isDirectory(),
      `unexpected file type: ${relative}`,
    );
    if (i === parts.length - 1 && leafType === 'file') {
      requireThat(stat.size <= 1024 * 1024, `file exceeds 1 MiB: ${relative}`);
    }
  }
  return current;
}

function validate(files) {
  let manifest, mcp;
  try {
    manifest = JSON.parse(files.get('plugin.json').toString('utf8'));
    mcp = JSON.parse(files.get('mcp.json').toString('utf8'));
  } catch {
    throw new Error('plugin.json and mcp.json must contain valid JSON');
  }
  keys(
    manifest,
    ['$schema', 'name', 'version', 'description', 'author', 'extensions'],
    'plugin.json',
  );
  requireThat(manifest.$schema === `${schemaRoot}plugin.schema.json`, 'unsupported plugin schema');
  requireThat(manifest.name === name, 'plugin name must match its directory');
  requireThat(
    typeof manifest.version === 'string' &&
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/.test(
        manifest.version,
      ),
    'version must be strict SemVer',
  );
  text(manifest.description, 'description');
  keys(manifest.author, ['name'], 'author');
  text(manifest.author.name, 'author.name');
  keys(manifest.extensions, ['com.openai'], 'extensions');
  keys(manifest.extensions['com.openai'], ['interface'], 'com.openai');
  const ui = manifest.extensions['com.openai'].interface;
  keys(
    ui,
    [
      'displayName',
      'shortDescription',
      'longDescription',
      'developerName',
      'category',
      'capabilities',
      'defaultPrompt',
    ],
    'interface',
  );
  for (const key of [
    'displayName',
    'shortDescription',
    'longDescription',
    'developerName',
    'category',
  ])
    text(ui[key], key);
  requireThat([...ui.shortDescription].length <= 30, 'shortDescription exceeds 30 characters');
  requireThat(
    Array.isArray(ui.capabilities) &&
      ui.capabilities.length === 1 &&
      ui.capabilities[0] === 'Interactive',
    'unsupported capabilities',
  );
  const prompts = typeof ui.defaultPrompt === 'string' ? [ui.defaultPrompt] : ui.defaultPrompt;
  requireThat(
    Array.isArray(prompts) && prompts.length >= 1 && prompts.length <= 3,
    'defaultPrompt must be text or one to three prompts',
  );
  for (const prompt of prompts) text(prompt, 'defaultPrompt');

  keys(mcp, ['$schema', 'mcpServers'], 'mcp.json');
  requireThat(mcp.$schema === `${schemaRoot}mcp.schema.json`, 'unsupported MCP schema');
  keys(mcp.mcpServers, [name], 'mcpServers');
  const server = mcp.mcpServers[name];
  keys(server, ['type', 'url'], 'MCP server'); // No headers, secrets or fabricated OAuth settings.
  requireThat(server.type === 'streamable-http', 'MCP transport must be streamable-http');
  text(server.url, 'MCP URL');
  let url;
  try {
    url = new URL(server.url);
  } catch {
    throw new Error('invalid MCP URL');
  }
  requireThat(
    url.protocol === 'https:' &&
      url.pathname === '/mcp' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    'MCP URL must be HTTPS /mcp without credentials, query or fragment',
  );
  const skill = files.get(skillPath).toString('utf8');
  requireThat(
    /^---\nname: foundry-workflow\ndescription: [^\n]+\n---\n[\s\S]*\S/.test(skill),
    'skill requires matching name, description and body',
  );
}

function main() {
  const args = process.argv.slice(2);
  const usage =
    'usage: node scripts/build-chatgpt-plugin.mjs [--gateway-url <https-url>] [--root <repository>]';
  let rootArg;
  let gatewayArg;
  for (let i = 0; i < args.length; i += 2) {
    requireThat(
      (args[i] === '--root' || args[i] === '--gateway-url') &&
        args[i + 1] !== undefined &&
        !args[i + 1].startsWith('--'),
      usage,
    );
    if (args[i] === '--root') rootArg = args[i + 1];
    else gatewayArg = args[i + 1];
  }
  let gatewayMcpUrl;
  if (gatewayArg !== undefined) {
    let g;
    try {
      g = new URL(gatewayArg);
    } catch {
      g = undefined;
    }
    requireThat(
      g && g.protocol === 'https:' && !g.username && !g.password && !g.search && !g.hash,
      '--gateway-url must be an https URL without credentials, query or fragment',
    );
    gatewayMcpUrl = `${g.origin}${g.pathname.replace(/\/+$/, '')}/mcp`;
  }
  const root = path.resolve(
    rootArg ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
  );
  const source = `plugins/${name}`;
  // An explicit allowlist means notes, credentials, dependency trees and unrelated assets never enter the archive.
  const files = new Map(
    ['plugin.json', 'mcp.json', skillPath].map((relative) => [
      relative,
      readFileSync(regularPath(root, `${source}/${relative}`, 'file')),
    ]),
  );
  validate(files);
  if (gatewayMcpUrl !== undefined) {
    const mcp = JSON.parse(files.get('mcp.json').toString('utf8'));
    mcp.mcpServers[name].url = gatewayMcpUrl;
    files.set('mcp.json', Buffer.from(JSON.stringify(mcp, null, 2) + '\n'));
    validate(files);
  }
  const outDir = regularPath(root, 'dist/release', 'directory', true);
  mkdirSync(outDir, { recursive: true });
  const stage = mkdtempSync(path.join(outDir, '.chatgpt-plugin-'));
  try {
    for (const [relative, bytes] of files) {
      const target = path.join(stage, name, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
    const archive = path.join(stage, 'plugin.zip');
    execFileSync(
      'zip',
      ['-q', '-X', archive, ...[...files.keys()].map((relative) => `${name}/${relative}`)],
      { cwd: stage, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const output = path.join(outDir, `${name}-chatgpt.zip`);
    // Refuse directories at the output path; rename replaces a prior file or symlink, never follows it.
    requireThat(
      !existsSync(output) || !lstatSync(output).isDirectory(),
      'archive output is a directory',
    );
    renameSync(archive, output);
    console.log(output);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  // Do not echo JSON contents, URLs or tool stderr: input may contain credentials.
  console.error(
    `build-chatgpt-plugin: ${error.code === 'ENOENT' ? 'zip is not installed' : error.status !== undefined ? 'zip failed' : error.message}`,
  );
  process.exitCode = 1;
}
