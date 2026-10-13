import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { E2eConfig, E2ePaths } from './config.js';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GATEWAY_CLI = join(REPO_ROOT, 'gateway', 'dist', 'bin', 'cli.js');

/** The arguments after `node` for a harness-spawned gateway. */
/** `--user` is omitted when `user` is undefined (the ambiguity suite). */
export function gatewayArgs(
  config: E2eConfig,
  paths: E2ePaths,
  user: string | undefined,
  extra: readonly string[] = [],
): string[] {
  const args = [
    GATEWAY_CLI,
    '--link-port',
    String(config.linkPort),
    '--db',
    paths.db,
    '--allow-origin',
    config.foundryOrigin,
    '--world',
    config.world,
  ];
  if (user !== undefined) args.push('--user', user);
  args.push(...extra);
  return args;
}

const CODE_RE = /Pairing code:\s*(\S+)/;
export function parsePairingCode(stderr: string): string | undefined {
  return CODE_RE.exec(stderr)?.[1];
}

export interface CallResult {
  isError: boolean;
  /** First text block, or all text blocks joined. */
  text: string;
  structured: Record<string, unknown> | undefined;
  /** The whole MCP result, for the leak check. */
  raw: unknown;
}

export class GatewayProcess {
  private stderrText = '';
  private pid: number | null = null;
  private client: Client | undefined;
  private transport: StdioClientTransport | undefined;

  constructor(
    private readonly config: E2eConfig,
    private readonly paths: E2ePaths,
    readonly user: string | undefined,
    /** Extra CLI arguments, for a second instance (`--http`, `--http-port`, a differing setting). */
    private readonly extraArgs: readonly string[] = [],
  ) {}

  get stderr(): string {
    return this.stderrText;
  }

  /** The recorded PID of the child we started; the only process we ever signal. */
  get childPid(): number | null {
    return this.pid;
  }

  async start(): Promise<void> {
    if (!existsSync(GATEWAY_CLI)) {
      throw new Error(`gateway is not built (${GATEWAY_CLI}); run npm run build`);
    }
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: gatewayArgs(this.config, this.paths, this.user, this.extraArgs),
      stderr: 'pipe',
      cwd: REPO_ROOT,
    });
    transport.stderr?.on('data', (b: Buffer) => {
      this.stderrText += b.toString('utf8');
    });
    const client = new Client({ name: 'agent-gateway-e2e', version: '0.0.0' });
    this.transport = transport;
    this.client = client;
    try {
      await client.connect(transport);
    } catch (err) {
      // The child may already be running; record its PID so stop() can still reap it.
      this.pid = transport.pid;
      await this.stop();
      throw err;
    }
    this.pid = transport.pid;
  }

  /** Wait for the "Pairing code:" line the gateway prints once per process start. */
  async pairingCode(timeoutMs = 10_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const code = parsePairingCode(this.stderrText);
      if (code) return code;
      if (Date.now() > deadline) throw new Error('gateway printed no pairing code');
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** The whole `tools/list` result, for the leak check. */
  async listToolsRaw(): Promise<{ tools: Array<{ name: string }> }> {
    return this.mcp().listTools();
  }

  async listTools(): Promise<string[]> {
    return (await this.listToolsRaw()).tools.map((t) => t.name);
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<CallResult> {
    const res = await this.mcp().callTool({ name, arguments: args });
    const content = (res.content ?? []) as Array<{ type: string; text?: string }>;
    const text = content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');
    return {
      isError: res.isError === true,
      text,
      structured: res.structuredContent as Record<string, unknown> | undefined,
      raw: res,
    };
  }

  /** Close the session, then make sure our own child is gone, by its recorded PID only. */
  async stop(): Promise<void> {
    const pid = this.pid;
    try {
      await this.client?.close();
    } catch {
      /* already closed */
    }
    this.client = undefined;
    this.transport = undefined;
    if (pid !== null && isAlive(pid)) {
      await new Promise((r) => setTimeout(r, 1500));
      if (isAlive(pid)) process.kill(pid, 'SIGKILL');
    }
    this.pid = null;
  }

  private mcp(): Client {
    if (!this.client) throw new Error('gateway not started');
    return this.client;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Poll `world_info` until the bound user's module is connected. Returns the structured result. */
export async function waitConnected(
  gw: GatewayProcess,
  timeoutMs: number,
  intervalMs = 1000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  for (;;) {
    const r = await gw.call('world_info');
    if (!r.isError && r.structured) return r.structured;
    last = r.text;
    if (Date.now() + intervalMs > deadline) {
      throw new NotConnectedError(gw.user ?? '(unbound)', timeoutMs, last);
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}

export class NotConnectedError extends Error {
  constructor(user: string, timeoutMs: number, last: string) {
    super(
      `${user}: the module did not connect to the gateway within ${Math.round(timeoutMs / 1000)}s (last answer: ${last}); run npm run test:e2e:setup`,
    );
  }
}
