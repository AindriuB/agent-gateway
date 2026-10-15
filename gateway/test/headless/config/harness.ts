import { PassThrough } from 'node:stream';
import { createApp, type App } from '../../../src/app.js';
import { profileDir } from '../../../src/headless/profile.js';
import type { BrowserLauncher, LaunchRequest } from '../../../src/headless/runner.js';
import { openStore } from '../../../src/store/index.js';
import { ORIGIN } from '../../link/helpers.js';
import { freePort, tempState } from '../../relay/harness.js';
import { FakeLauncher } from '../fake-browser.js';

export const W = 'w1';
export type Config = Parameters<typeof createApp>[0];

/** One launcher for every runner, as in the app; routes each launch to that agent's fake page. */
export class MultiLauncher implements BrowserLauncher {
  readonly launches: LaunchRequest[] = [];
  private readonly byProfile = new Map<string, FakeLauncher>();

  constructor(
    private readonly stateDir: string,
    private readonly linkPort: () => number,
  ) {}

  forUser(userId: string): FakeLauncher {
    const key = profileDir(this.stateDir, W, userId);
    let f = this.byProfile.get(key);
    if (!f) {
      f = new FakeLauncher({
        ids: { worldId: W, userId, origin: ORIGIN, linkPort: this.linkPort },
      });
      this.byProfile.set(key, f);
    }
    return f;
  }

  launch(req: LaunchRequest) {
    this.launches.push(req);
    const f = this.byProfile.get(req.profileDir);
    if (!f) throw new Error(`no fake page for ${req.profileDir}`);
    return f.launch(req);
  }
}

export interface AgentSpec {
  name: string;
  userId: string;
  /** Held by this gateway; absent means the password key is missing. */
  password?: string;
}

/** Store the rows the way `headless add` does, before any gateway starts. */
export function seedAgents(db: string, agents: readonly AgentSpec[], owner?: string): void {
  const s = openStore(db);
  for (const a of agents)
    s.headless.add({
      name: a.name,
      foundryUrl: ORIGIN,
      worldId: W,
      userId: a.userId,
      ownerUserId: owner ?? null,
    });
  s.close();
}

export async function startGateway(o: {
  state: ReturnType<typeof tempState>;
  linkPort: number;
  /** Agents whose passwords this process holds. */
  agents?: readonly AgentSpec[];
  multi: MultiLauncher;
  sweepMs?: number;
  noSandbox?: boolean;
  httpPort?: number;
  discover?: NonNullable<Parameters<typeof createApp>[1]['headless']>['discover'];
  launcherFor?: NonNullable<Parameters<typeof createApp>[1]['headless']>['launcherFor'];
  config?: Record<string, unknown>;
  noLauncher?: boolean;
}) {
  let httpPort = o.httpPort ?? (await freePort());
  while (httpPort === o.linkPort) httpPort = await freePort();
  const lines: string[] = [];
  const passwords: Record<string, string> = {};
  for (const a of o.agents ?? []) if (a.password !== undefined) passwords[a.name] = a.password;
  const config = {
    linkPort: o.linkPort,
    httpPort,
    logLevel: 'error',
    headlessNoSandbox: o.noSandbox ?? false,
    headlessAgentPasswords: passwords,
    ...o.config,
  } as unknown as Config;
  const app: App = createApp(config, {
    version: '0.0.0-test',
    dbPath: o.state.db,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    writeStatus: (l) => void lines.push(l),
    http: true,
    ...(o.sweepMs ? { revocationSweepMs: o.sweepMs } : {}),
    headless: {
      ...(o.noLauncher ? {} : { launcher: o.multi }),
      ...(o.discover ? { discover: o.discover } : {}),
      ...(o.launcherFor ? { launcherFor: o.launcherFor } : {}),
      runner: {
        fetch: (async () =>
          new Response(JSON.stringify({ active: true, world: W }), {
            status: 200,
          })) as typeof fetch,
        pollMs: 3_600_000,
        linkGraceMs: 50,
        pairWaitMs: 5_000,
      },
    },
  });
  await app.start();
  return { app, lines, httpPort };
}
