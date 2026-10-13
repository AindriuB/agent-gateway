import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { coreAnnouncements, FIXTURE_PACK_TOOL, hello, ORIGIN } from '../conformance/fake-module.js';

export const cliPath = fileURLToPath(new URL('../../dist/bin/cli.js', import.meta.url));

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function until(cond: () => boolean, ms = 10_000, what = 'condition'): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

export const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = createNetServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

/** A temp state dir short enough for a Unix socket path. */
export function tempState(): { dir: string; db: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'agr-'));
  return {
    dir,
    db: join(dir, 'g.db'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export interface RecordedCall {
  sessionId: string;
  name: string;
  value: string;
}

/** A fake Foundry module: pairs once, then reconnects with its token and answers fixture calls. */
export class FakeModule {
  token: string | undefined;
  readonly calls: RecordedCall[] = [];
  /** Calls whose value equals this are never answered (for in-flight tests). */
  hang: string | undefined;
  private ws: WebSocket | undefined;
  ready = false;

  constructor(private readonly port: number) {}

  async connect(auth: { code: string } | 'token'): Promise<void> {
    const ws = new WebSocket(`ws://127.0.0.1:${this.port}`, { origin: ORIGIN });
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    ws.on('close', () => (this.ready = false));
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as {
        type: string;
        id?: string;
        sessionId?: string;
        tool?: string;
        name?: string;
        args?: { value?: string };
        pairingToken?: string;
      };
      if (m.type === 'welcome') {
        if (m.pairingToken) this.token = m.pairingToken;
        ws.send(JSON.stringify({ type: 'eventPolicy', enabled: true, retentionDays: 7 }));
        ws.send(
          JSON.stringify({
            type: 'toolset',
            eventReadAllowed: true,
            tools: [...coreAnnouncements(), FIXTURE_PACK_TOOL],
          }),
        );
        ws.send(JSON.stringify({ type: 'ping' }));
      } else if (m.type === 'pong') {
        this.ready = true;
      } else if (m.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (m.type === 'call') {
        const value = m.args?.value ?? '';
        this.calls.push({ sessionId: m.sessionId ?? '', name: m.tool ?? m.name ?? '', value });
        if (value === this.hang) return;
        ws.send(
          JSON.stringify({
            type: 'result',
            id: m.id,
            ok: true,
            text: `echo:${value}`,
            structured: { value },
          }),
        );
      }
    });
    ws.send(
      JSON.stringify(
        hello(
          auth === 'token'
            ? { kind: 'pairingToken', token: this.token }
            : { kind: 'pairingCode', code: auth.code },
        ),
      ),
    );
    await until(() => this.ready, 10_000, 'fake module ready');
  }

  /** Keep the module connected through gateway restarts. */
  keepAlive(): void {
    const loop = async () => {
      while (!this.stopped) {
        if (!this.ready) await this.connect('token').catch(() => undefined);
        await sleep(100);
      }
    };
    void loop();
  }
  private stopped = false;

  close(): void {
    this.stopped = true;
    this.ws?.terminate();
  }
}

export interface Cli {
  client: Client;
  pid: number;
  stderr: () => string;
  listChanged: () => number;
  close: () => Promise<void>;
}

/** Start the built CLI behind a real MCP SDK client on its stdio. */
export async function startCli(
  port: number,
  db: string,
  extra: string[] = [],
  connect = true,
  env: Record<string, string> = {},
): Promise<Cli> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, '--link-port', String(port), '--db', db, ...extra],
    env: { PATH: process.env.PATH ?? '', HOME: tmpdir(), ...env },
    stderr: 'pipe',
  });
  let err = '';
  let changed = 0;
  const client = new Client({ name: 'test', version: '0' });
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => void changed++);
  // stderr is available before start() when it is 'pipe'
  transport.stderr?.on('data', (d: Buffer) => (err += d.toString()));
  if (connect) await client.connect(transport);
  else await transport.start();
  return {
    client,
    get pid() {
      return transport.pid as number;
    },
    stderr: () => err,
    listChanged: () => changed,
    close: () => client.close().catch(() => undefined),
  };
}

export async function pairedPrimary(
  port: number,
  db: string,
): Promise<{ cli: Cli; module: FakeModule }> {
  const cli = await startCli(port, db);
  await until(() => /Pairing code: /.test(cli.stderr()), 10_000, 'pairing code');
  const code = /Pairing code: (\S+)/.exec(cli.stderr())![1]!;
  const module = new FakeModule(port);
  await module.connect({ code });
  return { cli, module };
}
