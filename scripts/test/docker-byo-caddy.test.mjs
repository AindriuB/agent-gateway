import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(path.join(repo, 'gateway/docker', f), 'utf8');
const byo = read('compose.byo-caddy.yaml');
const bundled = read('compose.yaml');

// Text of one top-level service, from "  name:" to the next two-space key.
const service = (text, name) => {
  const m = text.match(new RegExp(`^  ${name}:\\n((?:    .*\\n|\\n)*)`, 'm'));
  assert.ok(m, `service ${name} present`);
  return m[1];
};
// Text of a four-space key's block inside a service body.
const block = (body, key) => {
  const m = body.match(new RegExp(`^    ${key}:(.*)\\n((?:      .*\\n)*)`, 'm'));
  assert.ok(m, `${key} present`);
  return m[0];
};
const code = (text) => text.split('\n').filter((l) => !l.trim().startsWith('#'));

describe('compose.byo-caddy.yaml', () => {
  it('is gateway-only with host-or-container networking', () => {
    assert.match(byo, /^name: agent-gateway$/m);
    const servicesText = byo.split(/^services:\n/m)[1].split(/^volumes:/m)[0];
    assert.deepEqual(servicesText.match(/^ {2}[\w-]+:$/gm), ['  gateway:']);
    assert.doesNotMatch(code(byo).join('\n'), /caddy:|ACME_EMAIL|^\s*ports:/m);
    assert.match(byo, /^ {4}network_mode: \$\{GATEWAY_NETWORK_MODE:-host\}$/m);
    const body = service(byo, 'gateway');
    assert.match(block(body, 'volumes'), /- gateway-data:\/data\n$/);
    assert.equal(block(body, 'volumes').match(/- /g).length, 1);
    assert.match(byo, /^volumes:\n {2}gateway-data:\n*$/m);
  });

  it('keeps the gateway service identical to compose.yaml', () => {
    const a = service(byo, 'gateway');
    const b = service(bundled, 'gateway');
    for (const key of ['image', 'build', 'restart', 'environment']) {
      assert.equal(block(a, key), block(b, key), key);
    }
  });

  it('sets no bind address or port override', () => {
    for (const text of [byo, bundled]) {
      assert.doesNotMatch(
        code(text).join('\n'),
        /AGENT_GATEWAY_(HTTP_HOST|LINK_HOST|HTTP_PORT|LINK_PORT)/,
      );
    }
  });
});

describe('byo-caddy.Caddyfile', () => {
  const cf = read('byo-caddy.Caddyfile');
  const lines = code(cf).filter((l) => l.trim());
  it('is one site block with no global options', () => {
    assert.equal(lines[0], 'gateway.example.com {');
    assert.equal(lines.filter((l) => /^\S.*\{$/.test(l)).length, 1);
    assert.doesNotMatch(cf, /\bemail\b/);
  });
  it('routes like the bundled Caddyfile', () => {
    assert.match(cf, /handle \/link\* \{\s*reverse_proxy 127\.0\.0\.1:7420\s*\}/);
    assert.match(cf, /handle \{\s*reverse_proxy 127\.0\.0\.1:7421\s*\}/);
    assert.doesNotMatch(cf, /header_up|transport/);
  });
});

describe('.env.example', () => {
  it('gains the two commented lines and keeps the old ones', () => {
    const env = read('.env.example');
    assert.match(env, /^#COMPOSE_FILE=compose\.byo-caddy\.yaml$/m);
    assert.match(env, /^#GATEWAY_NETWORK_MODE=container:caddy$/m);
    for (const k of ['DOMAIN=', 'FOUNDRY_ORIGIN=', 'ACME_EMAIL=', '#AGENT_GATEWAY_LOG_LEVEL=']) {
      assert.ok(env.includes(k), k);
    }
  });
});

describe('README', () => {
  it('has the Bring your own Caddy section', () => {
    const readme = read('README.md');
    const m = readme.match(/^## Bring your own Caddy\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
    assert.ok(m, 'heading present');
    for (const s of [
      'COMPOSE_FILE=compose.byo-caddy.yaml',
      'network_mode: host',
      'GATEWAY_NETWORK_MODE=container:',
      'X-Forwarded-For',
      'rate-limit',
      'subdomain',
      '__Host-',
      '/link',
      '7420',
      '7421',
      'WebSocket',
      'docker compose exec gateway',
      '--invite',
    ]) {
      assert.ok(m[1].includes(s), s);
    }
  });
});
