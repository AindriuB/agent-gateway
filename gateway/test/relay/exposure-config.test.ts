import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  connectRelay,
  describeConfigDiff,
  makeRelayConfig,
  RelayServer,
  relayEndpoint,
  sameConfig,
  sameSessionConfig,
  type RelayConfig,
} from '../../src/relay/index.js';
import { parseRelayConfig } from '../../src/relay/config.js';
import { until } from './harness.js';

const PORT = 7778;
const BASE = makeRelayConfig([], 7421, 'info', 1000);

const rigs: { dir: string; server: RelayServer }[] = [];
afterEach(async () => {
  for (const r of rigs.splice(0)) {
    await r.server.close();
    rmSync(r.dir, { recursive: true, force: true });
  }
});

async function rig(onStepDown?: (why: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'agr-'));
  chmodSync(dir, 0o700);
  const ep = relayEndpoint(dir, PORT);
  if (!ep.ok) throw new Error(ep.reason);
  const server = new RelayServer({
    endpoint: ep.path,
    stateDir: dir,
    linkPort: PORT,
    config: BASE,
    selector: {},
    createSession: () => new Server({ name: 't', version: '0' }, { capabilities: {} }),
    log: () => undefined,
    ...(onStepDown ? { onStepDown } : {}),
  });
  await server.listen();
  rigs.push({ dir, server });
  return { dir, sock: ep.path };
}

const ask = (r: { dir: string; sock: string }, config: RelayConfig) =>
  connectRelay({ endpoint: r.sock, stateDir: r.dir, linkPort: PORT, config, selector: {} });

describe('exposure settings in the relay config', () => {
  it('reads a config without the new fields as off', () => {
    const old = {
      allowOrigins: [],
      httpPort: 7421,
      logLevel: 'info',
      startedAt: 5,
    };
    expect(parseRelayConfig(old)).toMatchObject({
      publicUrl: '',
      serverMode: false,
      linkHost: '127.0.0.1',
      httpHost: '127.0.0.1',
      trustProxy: false,
    });
  });

  it('treats publicUrl and serverMode as session-affecting, the rest as neutral', () => {
    const url = { ...BASE, publicUrl: 'https://gw.example.com' };
    const sm = { ...BASE, serverMode: true };
    expect(sameSessionConfig(BASE, url)).toBe(false);
    expect(sameSessionConfig(BASE, sm)).toBe(false);
    for (const over of [{ trustProxy: true }, { linkHost: '0.0.0.0' }, { httpHost: '0.0.0.0' }]) {
      const c = { ...BASE, ...over };
      expect(sameSessionConfig(BASE, c)).toBe(true);
      expect(sameConfig(BASE, c)).toBe(false);
    }
  });

  it('names each differing field', () => {
    const text = describeConfigDiff(BASE, {
      ...BASE,
      publicUrl: 'https://gw.example.com',
      serverMode: true,
      linkHost: '0.0.0.0',
      httpHost: '0.0.0.0',
      trustProxy: true,
    });
    for (const w of ['public URL', 'server mode', 'link host', 'http host', 'trust proxy'])
      expect(text).toContain(w);
  });

  it.each([{ publicUrl: 'https://gw.example.com' }, { serverMode: true }])(
    'does not serve an older instance that differs in %o, and a newer one steps it down',
    async (over) => {
      const stepped: string[] = [];
      const r = await rig((why) => stepped.push(why));
      const older = await ask(r, { ...BASE, ...over, startedAt: BASE.startedAt - 1 });
      expect(older).toMatchObject({ kind: 'refused', code: 'RELAY_CONFIG_MISMATCH' });
      const newer = await ask(r, { ...BASE, ...over, startedAt: BASE.startedAt + 1 });
      expect(newer).toMatchObject({ kind: 'refused', code: 'RELAY_CONFIG_STEPDOWN' });
      await until(() => stepped.length === 1, 5000, 'step down');
    },
    10_000,
  );

  it('serves an instance that differs only in trustProxy', async () => {
    const r = await rig();
    const c = await ask(r, { ...BASE, trustProxy: true, startedAt: BASE.startedAt - 1 });
    expect(c.kind).toBe('ok');
    if (c.kind === 'ok') c.upstream.close();
  });
});
