import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { connect, createServer, type Server as NetServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  makeRelayConfig,
  newSecret,
  parseSecretFile,
  RELAY_VERSION,
  RelaySecondary,
  RelayServer,
  relayEndpoint,
  writeSecret,
} from '../../src/relay/index.js';
import { sleep, until } from './harness.js';

const PORT = 17998;
const mcp = () => new Server({ name: 't', version: '0' }, { capabilities: {} });
const PLAIN = makeRelayConfig([], 17555, 'info', 9000);
const HEADLESS = makeRelayConfig([], 17555, 'info', 9000, { headless: 'abc' });

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanups.splice(0).reverse()) await f();
});

function dirAndEndpoint(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'agh-'));
  chmodSync(dir, 0o700);
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const ep = relayEndpoint(dir, PORT);
  if (!ep.ok) throw new Error(ep.reason);
  return { dir, path: ep.path };
}

/** A pre-37 primary: answers every hello with `{relay: 1, ok: true}` and no capability. */
async function oldPrimary(): Promise<{ dir: string; path: string; close: () => Promise<void> }> {
  const { dir, path } = dirAndEndpoint();
  writeSecret(dir, PORT, newSecret());
  const socks = new Set<Socket>();
  const net: NetServer = createServer((sock) => {
    socks.add(sock);
    sock.on('error', () => undefined);
    sock.once('data', () => sock.write(`${JSON.stringify({ relay: 1, ok: true })}\n`));
  });
  await new Promise<void>((r) => net.listen(path, () => r()));
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const s of socks) s.destroy();
    await new Promise((r) => net.close(r));
  };
  cleanups.push(close);
  return { dir, path, close };
}

function secondary(
  at: { dir: string; path: string },
  config: ReturnType<typeof makeRelayConfig>,
  becomePrimary: () => Promise<boolean> = () => Promise.resolve(false),
) {
  const s = new RelaySecondary({
    endpoint: at.path,
    stateDir: at.dir,
    linkPort: PORT,
    selector: {},
    config,
    input: new PassThrough(),
    output: new PassThrough(),
    log: () => undefined,
    becomePrimary,
    createDegraded: mcp,
    sleep: () => sleep(20),
  });
  cleanups.push(() => s.stop());
  return s;
}

describe('a headless caller and a primary from before headless settings', () => {
  it('goes to standby with a loud reason instead of relaying', async () => {
    const old = await oldPrimary();
    const s = secondary(old, HEADLESS);
    let settled: [string, string] | undefined;
    (s as unknown as { opts: { onSettled: (r: string, why: string) => void } }).opts.onSettled = (
      r,
      why,
    ) => (settled = [r, why]);
    await s.start('startup');
    expect(s.currentRole).toBe('standby');
    expect(settled?.[0]).toBe('standby');
    expect(settled?.[1]).toContain('primary too old, headless agent not running');
  });

  it('stays in standby while the old primary holds the port, then takes over when it leaves', async () => {
    const old = await oldPrimary();
    let free = false;
    const s = secondary(old, HEADLESS, () => Promise.resolve(free));
    await s.start('startup');
    expect(s.currentRole).toBe('standby');
    await sleep(500);
    expect(s.currentRole).toBe('standby');
    await old.close();
    free = true;
    await until(() => s.currentRole === 'primary', 5000, 'takeover');
  });

  it('is relayed to as before by a plain caller', async () => {
    const old = await oldPrimary();
    const s = secondary(old, PLAIN);
    await s.start('startup');
    expect(s.currentRole).toBe('relay');
  });
});

describe('a primary that understands headless settings', () => {
  async function newPrimary(config: ReturnType<typeof makeRelayConfig>) {
    const at = dirAndEndpoint();
    const server = new RelayServer({
      endpoint: at.path,
      stateDir: at.dir,
      linkPort: PORT,
      selector: {},
      config,
      createSession: mcp,
      log: () => undefined,
    });
    await server.listen();
    cleanups.push(() => server.close());
    return at;
  }

  it('serves an old caller exactly as before: relay 1, ok true', async () => {
    const at = await newPrimary(PLAIN);
    const secret = parseSecretFile(readFileSync(join(at.dir, `relay-${PORT}.secret`), 'utf8'));
    const reply = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const sock = connect(at.path);
      sock.on('error', reject);
      sock.once('connect', () => {
        const oldConfig: Record<string, unknown> = { ...PLAIN };
        delete oldConfig.headless;
        sock.write(
          `${JSON.stringify({ relay: RELAY_VERSION, secret: secret.secret, linkPort: PORT, config: oldConfig, selector: {} })}\n`,
        );
      });
      sock.once('data', (d) => {
        resolve(JSON.parse(d.toString().split('\n')[0]!) as Record<string, unknown>);
        sock.destroy();
      });
    });
    expect(reply).toMatchObject({ relay: 1, ok: true });
  });

  it('is relayed to by a headless caller with the same settings', async () => {
    const at = await newPrimary(HEADLESS);
    const s = secondary(at, HEADLESS);
    await s.start('startup');
    expect(s.currentRole).toBe('relay');
  });

  async function hello(
    at: { dir: string; path: string },
    over: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const secret = parseSecretFile(readFileSync(join(at.dir, `relay-${PORT}.secret`), 'utf8'));
    return new Promise((resolve, reject) => {
      const sock = connect(at.path);
      sock.on('error', reject);
      sock.once('connect', () => {
        sock.write(
          `${JSON.stringify({ relay: RELAY_VERSION, secret: secret.secret, linkPort: PORT, config: PLAIN, selector: {}, ...over })}\n`,
        );
      });
      sock.once('data', (d) => {
        resolve(JSON.parse(d.toString().split('\n')[0]!) as Record<string, unknown>);
        sock.destroy();
      });
    });
  }

  it('sends no capability in a pre-authentication refusal', async () => {
    const at = await newPrimary(PLAIN);
    const auth = await hello(at, { secret: 'wrong' });
    expect(auth).toMatchObject({ ok: false, code: 'RELAY_AUTH' });
    expect(auth).not.toHaveProperty('caps');
    const proto = await hello(at, { relay: 2 });
    expect(proto).toMatchObject({ ok: false, code: 'RELAY_PROTOCOL' });
    expect(proto).not.toHaveProperty('caps');
  });

  it('sends the capability in the ok reply and in authenticated refusals', async () => {
    const at = await newPrimary(PLAIN);
    expect(await hello(at, {})).toMatchObject({ ok: true, caps: ['headless'] });
    const mismatch = await hello(at, { config: makeRelayConfig(['x'], 17555, 'info', 9000) });
    expect(mismatch).toMatchObject({
      ok: false,
      code: 'RELAY_CONFIG_MISMATCH',
      caps: ['headless'],
    });
    const stepdown = await hello(at, {
      config: { ...PLAIN, logLevel: 'debug', startedAt: PLAIN.startedAt + 1000 },
    });
    expect(stepdown).toMatchObject({
      ok: false,
      code: 'RELAY_CONFIG_STEPDOWN',
      caps: ['headless'],
    });
  });

  it('keeps RELAY_VERSION at 1', () => {
    expect(RELAY_VERSION).toBe(1);
  });
});
