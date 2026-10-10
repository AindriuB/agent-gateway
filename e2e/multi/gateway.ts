import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { E2eConfig, E2ePaths } from '../lib/config.js';
import { GATEWAY_CLI, REPO_ROOT, type CallResult } from '../lib/gateway.js';

const run = promisify(execFile);

/** Gateway arguments like the harness's, but `--user` is optional (omitted for the ambiguity suite). */
export function multiGatewayArgs(
  config: E2eConfig,
  paths: E2ePaths,
  user: string | undefined,
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
  return args;
}

/** True while `ps -p <pid>` finds the process. By PID only. */
export async function pidAlive(pid: number): Promise<boolean> {
  try {
    await run('ps', ['-p', String(pid)]);
    return true;
  } catch {
    return false;
  }
}

/**
 * A gateway child that may run with or without `--user`. The harness's GatewayProcess always
 * passes `--user`, so this small sibling starts the same command line without it. It stops the
 * child by its recorded PID and nothing else.
 */
export class MultiGateway {
  private pid: number | null = null;
  private client: Client | undefined;
  private stderrText = '';

  constructor(
    private readonly config: E2eConfig,
    private readonly paths: E2ePaths,
    readonly user: string | undefined,
  ) {}

  get childPid(): number | null {
    return this.pid;
  }

  get stderr(): string {
    return this.stderrText;
  }

  async start(): Promise<void> {
    if (!existsSync(GATEWAY_CLI)) {
      throw new Error(`gateway is not built (${GATEWAY_CLI}); run npm run build`);
    }
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: multiGatewayArgs(this.config, this.paths, this.user),
      stderr: 'pipe',
      cwd: REPO_ROOT,
    });
    transport.stderr?.on('data', (b: Buffer) => {
      this.stderrText += b.toString('utf8');
    });
    const client = new Client({ name: 'agent-gateway-e2e-multi', version: '0.0.0' });
    this.client = client;
    try {
      await client.connect(transport);
    } catch (err) {
      this.pid = transport.pid;
      await this.stop();
      throw err;
    }
    this.pid = transport.pid;
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<CallResult> {
    if (!this.client) throw new Error('gateway not started');
    const res = await this.client.callTool({ name, arguments: args });
    const content = (res.content ?? []) as Array<{ type: string; text?: string }>;
    return {
      isError: res.isError === true,
      text: content
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n'),
      structured: res.structuredContent as Record<string, unknown> | undefined,
      raw: res,
    };
  }

  /**
   * Close the MCP session (the SDK ends the child it spawned), then confirm that PID is gone and
   * send it SIGKILL if it is not. Returns once the recorded PID no longer exists.
   */
  async stop(): Promise<void> {
    const pid = this.pid;
    try {
      await this.client?.close();
    } catch {
      /* already closed */
    }
    this.client = undefined;
    if (pid !== null && (await pidAlive(pid))) {
      await run('kill', ['-KILL', String(pid)]).catch(() => undefined);
    }
    this.pid = null;
  }
}
