import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(repo, 'scripts/build-chatgpt-plugin.mjs');
const name = 'foundry-agent-gateway';
const tmp = mkdtempSync(path.join(tmpdir(), 'chatgpt-plugin-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
function fixture() {
  const root = mkdtempSync(path.join(tmp, 'case-'));
  cpSync(path.join(repo, 'plugins', name), path.join(root, 'plugins', name), { recursive: true });
  return root;
}
const source = (root, file) => path.join(root, 'plugins', name, file);
const archive = (root) => path.join(root, 'dist/release', `${name}-chatgpt.zip`);
const run = (root) => spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' });
function edit(root, file, change) {
  const json = JSON.parse(readFileSync(source(root, file), 'utf8'));
  change(json);
  writeFileSync(source(root, file), JSON.stringify(json));
}
function rejected(root, pattern) {
  const result = run(root);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, pattern);
  return result;
}

describe('ChatGPT plugin package', () => {
  it('archives only the three reviewed files under one root, with exact source bytes', () => {
    const root = fixture();
    for (const file of [
      '.env',
      'notes.txt',
      'node_modules/dependency/token.txt',
      'assets/unrelated.svg',
    ]) {
      const target = source(root, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, 'DO_NOT_PACKAGE');
    }
    symlinkSync(path.join(tmp, 'absent'), source(root, 'unrelated-link'));
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), archive(root));
    const entries = execFileSync('unzip', ['-Z1', archive(root)], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .sort();
    const expected = ['plugin.json', 'mcp.json', 'skills/foundry-workflow/SKILL.md'];
    assert.deepEqual(entries, expected.map((file) => `${name}/${file}`).sort());
    for (const file of expected)
      assert.deepEqual(
        execFileSync('unzip', ['-p', archive(root), `${name}/${file}`]),
        readFileSync(source(root, file)),
      );
    const connection = JSON.parse(
      execFileSync('unzip', ['-p', archive(root), `${name}/mcp.json`], { encoding: 'utf8' }),
    );
    assert.equal(connection.mcpServers[name].url, 'https://gateway.example.invalid/mcp');
  });

  it('--gateway-url writes <url>/mcp into the archive and leaves the source untouched', () => {
    const root = fixture();
    const before = readFileSync(source(root, 'mcp.json'));
    const result = spawnSync(
      process.execPath,
      [script, '--root', root, '--gateway-url', 'https://gw.example.org/'],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const connection = JSON.parse(
      execFileSync('unzip', ['-p', archive(root), `${name}/mcp.json`], { encoding: 'utf8' }),
    );
    assert.equal(connection.mcpServers[name].url, 'https://gw.example.org/mcp');
    assert.deepEqual(readFileSync(source(root, 'mcp.json')), before);
  });

  it('rejects an invalid --gateway-url without echoing it', () => {
    for (const [label, args] of [
      ['missing value', ['--gateway-url']],
      ['http', ['--gateway-url', 'http://secret-host.example']],
      ['credentials', ['--gateway-url', 'https://user:secret@gw.example']],
      ['query', ['--gateway-url', 'https://gw.example/?token=secret']],
      ['fragment', ['--gateway-url', 'https://gw.example/#secret']],
      ['not a url', ['--gateway-url', 'secret not a url']],
    ]) {
      const root = fixture();
      const result = spawnSync(process.execPath, [script, '--root', root, ...args], {
        encoding: 'utf8',
      });
      assert.equal(result.status, 1, label);
      assert.doesNotMatch(result.stderr, /secret/, label);
      assert.equal(result.stdout, '', label);
    }
  });

  it('allows an explicitly changed self-hosted HTTPS resource without adding auth fields', () => {
    const root = fixture();
    edit(root, 'mcp.json', (m) => {
      m.mcpServers[name].url = 'https://gateway.example.org/mcp';
    });
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
  });

  it('rejects missing required files and malformed JSON', () => {
    for (const file of ['plugin.json', 'mcp.json', 'skills/foundry-workflow/SKILL.md']) {
      const root = fixture();
      rmSync(source(root, file));
      rejected(root, /missing/);
    }
    const root = fixture();
    writeFileSync(source(root, 'plugin.json'), '{"secret":"do-not-echo"');
    const result = rejected(root, /valid JSON/);
    assert.doesNotMatch(result.stderr, /do-not-echo/);
  });

  it('rejects wrong identities, invalid SemVer, oversized subtitles, references and unsupported fields', () => {
    const cases = [
      [
        (m) => {
          m.name = 'other';
        },
        /name must match/,
      ],
      [
        (m) => {
          m.version = '01.2.3';
        },
        /SemVer/,
      ],
      [
        (m) => {
          m.version = '1.2.3-01';
        },
        /SemVer/,
      ],
      [
        (m) => {
          m.extensions['com.openai'].interface.shortDescription = 'x'.repeat(31);
        },
        /30 characters/,
      ],
      [
        (m) => {
          m.extensions['com.openai'].interface.logo = '../missing.svg';
        },
        /unsupported fields/,
      ],
      [
        (m) => {
          m.extensions['com.openai'].apps = './.app.json';
        },
        /unsupported fields/,
      ],
      [
        (m) => {
          m.author = null;
        },
        /expected object/,
      ],
    ];
    for (const [change, pattern] of cases) {
      const root = fixture();
      edit(root, 'plugin.json', change);
      rejected(root, pattern);
    }
  });

  it('rejects credential-bearing URLs, insecure endpoints, other transports and headers', () => {
    for (const url of [
      'http://gw.example/mcp',
      'https://user:secret@gw.example/mcp',
      'https://gw.example/mcp?token=secret',
      'https://gw.example/mcp#secret',
      'https://gw.example/',
      'not-a-url',
    ]) {
      const root = fixture();
      edit(root, 'mcp.json', (m) => {
        m.mcpServers[name].url = url;
      });
      const result = rejected(root, /MCP URL/);
      assert.doesNotMatch(result.stderr, /secret/);
    }
    for (const change of [
      (s) => {
        s.headers = { Authorization: 'Bearer secret' };
      },
      (s) => {
        s.type = 'stdio';
      },
    ]) {
      const root = fixture();
      edit(root, 'mcp.json', (m) => change(m.mcpServers[name]));
      const result = rejected(root, /unsupported fields|transport/);
      assert.doesNotMatch(result.stderr, /Bearer secret/);
    }
  });

  it('rejects required leaf and ancestor symlinks instead of reading outside package input', () => {
    for (const relative of ['plugin.json', 'skills', '.']) {
      const root = fixture();
      const target = source(root, relative);
      const outside = path.join(tmp, `outside-${path.basename(root)}`);
      cpSync(target, outside, { recursive: true });
      rmSync(target, { recursive: true });
      symlinkSync(outside, target);
      rejected(root, /symlink/);
    }
  });

  it('rejects a symlinked output directory', () => {
    const root = fixture();
    const outside = mkdtempSync(path.join(tmp, 'output-'));
    symlinkSync(outside, path.join(root, 'dist'));
    rejected(root, /symlink/);
  });

  it('validates skill identity and limits input size', () => {
    const root = fixture();
    const file = 'skills/foundry-workflow/SKILL.md';
    writeFileSync(source(root, file), '---\nname: wrong\ndescription: wrong\n---\nbody');
    rejected(root, /skill requires/);
    writeFileSync(source(root, file), 'x'.repeat(1024 * 1024 + 1));
    rejected(root, /exceeds 1 MiB/);
  });

  it('keeps the previous valid archive when validation fails', () => {
    const root = fixture();
    assert.equal(run(root).status, 0);
    const before = readFileSync(archive(root));
    edit(root, 'plugin.json', (m) => {
      m.name = 'wrong';
    });
    rejected(root, /name must match/);
    assert.deepEqual(readFileSync(archive(root)), before);
  });

  it('rejects invalid CLI arguments', () => {
    for (const args of [['--root'], ['--unknown'], ['--root', tmp, 'extra']]) {
      const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /usage:/);
    }
  });
});
