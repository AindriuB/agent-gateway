import { chmodSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { PassThrough } from 'node:stream';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearClaim,
  heirFile,
  readClaim,
  RELAY_CLAIM_SLACK_MS,
  RelaySecondary,
  STEPDOWN_GRACE_MS,
  writeClaim,
  makeRelayConfig,
  newSecret,
  relayEndpoint,
  writeSecret,
} from '../../src/relay/index.js';
import { sleep, tempState, until } from './harness.js';

const TTL = STEPDOWN_GRACE_MS + RELAY_CLAIM_SLACK_MS;
const PORT = 17999;

describe('handover claim file', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => cleanups.splice(0).forEach((f) => f()));
  const dir = () => {
    const s = tempState();
    chmodSync(s.dir, 0o700);
    cleanups.push(s.cleanup);
    return s.dir;
  };

  it('writes atomically at 0600, reads back, and clears', () => {
    const d = dir();
    writeClaim(d, PORT, 1234);
    const file = join(d, heirFile(PORT));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readClaim(d, PORT)).toMatchObject({ heir: 1234 });
    expect(existsSync(`${file}.${process.pid}.tmp`)).toBe(false);
    clearClaim(d, PORT);
    expect(readClaim(d, PORT)).toBeUndefined();
    expect(readClaim(d, PORT + 1)).toBeUndefined(); // other ports are separate
  });

  it.each(['', 'nope', '[]', 'null', '{"heir":"1","at":2}', '{"heir":1}', 'x'.repeat(5000)])(
    'treats %j as no claim',
    (text) => {
      const d = dir();
      writeFileSync(join(d, heirFile(PORT)), text);
      expect(readClaim(d, PORT)).toBeUndefined();
    },
  );
});

describe('a handover claim keeps older instances off the link port', () => {
  const secondaries: RelaySecondary[] = [];
  const cleanups: (() => void)[] = [];
  afterEach(async () => {
    for (const s of secondaries.splice(0)) await s.stop();
    cleanups.splice(0).forEach((f) => f());
  });

  /** A demoted instance that ends up polling as a standby every ~100 ms. */
  async function standby(dir: string, startedAt: number, binds: { n: number; win: boolean }) {
    const s = new RelaySecondary({
      endpoint: join(dir, 'none.sock'),
      stateDir: dir,
      linkPort: PORT,
      selector: {},
      config: makeRelayConfig([], 7421, 'info', startedAt),
      input: new PassThrough(),
      output: new PassThrough(),
      log: () => undefined,
      becomePrimary: () => Promise.resolve(binds.n++ >= 0 && binds.win),
      createDegraded: () => new Server({ name: 't', version: '0' }, { capabilities: {} }),
      sleep: () => sleep(100),
    });
    secondaries.push(s);
    await s.demote('test', () => Promise.resolve());
    await until(
      () => s.currentRole === 'standby' || s.currentRole === 'primary',
      10_000,
      'standby',
    );
    return s;
  }

  it('never binds during a fresh claim, binds after it expires, and the heir binds through it', async () => {
    const state = tempState();
    chmodSync(state.dir, 0o700);
    cleanups.push(state.cleanup);
    const binds = { n: 0, win: false };
    const other = await standby(state.dir, 1000, binds);
    // A claim for a newer instance that expires in about a second.
    writeFileSync(
      join(state.dir, heirFile(PORT)),
      JSON.stringify({ heir: 5000, at: Date.now() - TTL + 1000 }),
    );
    const during = binds.n;
    await sleep(700);
    expect(binds.n, 'no bind attempts while the claim is fresh').toBe(during);
    await until(() => binds.n > during, 5000, 'a bind attempt once the claim expired');

    // The heir itself is not held back, and clears the claim after it binds.
    await other.stop();
    writeClaim(state.dir, PORT, 7000);
    const heirBinds = { n: 0, win: true };
    const heir = await standby(state.dir, 7000, heirBinds);
    await until(() => heir.currentRole === 'primary', 5000, 'heir binds');
    expect(heirBinds.n).toBeGreaterThan(0);
    expect(readClaim(state.dir, PORT)).toBeUndefined();
  }, 30_000);
});

describe('a STEPDOWN refusal does not spend a connect attempt', () => {
  it('keeps waiting for older instances to hand over, past the attempt budget', async () => {
    const state = tempState();
    chmodSync(state.dir, 0o700);
    const ep = relayEndpoint(state.dir, PORT);
    if (!ep.ok) throw new Error(ep.reason);
    writeSecret(state.dir, PORT, newSecret());
    // An older primary that always asks to be replaced (and, in this test, never goes away).
    const net = createServer((sock) => {
      sock.on('error', () => undefined);
      sock.once('data', () => {
        sock.end(`${JSON.stringify({ relay: 1, ok: false, code: 'RELAY_CONFIG_STEPDOWN' })}\n`);
      });
    });
    await new Promise<void>((r) => net.listen(ep.path, () => r()));
    let binds = 0;
    const s = new RelaySecondary({
      endpoint: ep.path,
      stateDir: state.dir,
      linkPort: PORT,
      selector: {},
      config: makeRelayConfig([], 7421, 'info', 9000),
      input: new PassThrough(),
      output: new PassThrough(),
      log: () => undefined,
      // The older instance wins the port 14 times (more than the 10-attempt budget), then we do.
      becomePrimary: () => Promise.resolve(++binds > 14),
      createDegraded: () => new Server({ name: 't', version: '0' }, { capabilities: {} }),
      sleep: () => sleep(5),
    });
    try {
      await s.start('startup');
      expect(s.currentRole).toBe('primary');
      expect(binds).toBe(15);
    } finally {
      await s.stop();
      await new Promise((r) => net.close(r));
      state.cleanup();
    }
  }, 30_000);
});
