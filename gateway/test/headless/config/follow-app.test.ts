import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { createApp, type App } from '../../../src/app.js';
import { openStore } from '../../../src/store/index.js';
import { ORIGIN } from '../../link/helpers.js';
import { TestConsent } from '../../oauth/helpers.js';
import { freePort, tempState, until } from '../../relay/harness.js';
import { FakeLauncher } from '../fake-browser.js';

const W = 'w1';
const U = 'agentuser0000001';
type Config = Parameters<typeof createApp>[0];

const apps: App[] = [];
const clients: Client[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => undefined);
  for (const a of apps.splice(0)) await a.stop();
  for (const c of cleanups.splice(0)) c();
});

const ports = async () => {
  const linkPort = await freePort();
  let httpPort = await freePort();
  while (httpPort === linkPort) httpPort = await freePort();
  return { linkPort, httpPort };
};

describe('app wiring: which sessions can bind a headless agent', () => {
  it('follow mode (deps.selector without a user) does not bind a connected agent', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const { linkPort, httpPort } = await ports();
    const launcher = new FakeLauncher({
      ids: { worldId: W, userId: U, origin: ORIGIN, linkPort: () => linkPort },
    });
    const lines: string[] = [];
    const app = createApp(
      {
        linkPort,
        httpPort,
        logLevel: 'error',
        headlessFoundryUrl: ORIGIN,
        headlessWorld: W,
        headlessUser: U,
        headlessPassword: 'hunter2',
      } as unknown as Config,
      {
        version: '0.0.0-test',
        dbPath: state.db,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        writeStatus: (l) => void lines.push(l),
        http: true,
        selector: {},
        headless: {
          launcher,
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
      },
    );
    apps.push(app);
    await app.start();
    await until(() => lines.some((l) => l.startsWith('link connected')), 10_000, 'agent link');
    await until(() => lines.some((l) => l.startsWith('HTTP bearer token')), 10_000, 'token');
    const token = /: (\S+)$/.exec(lines.find((l) => l.startsWith('HTTP bearer token'))!)![1]!;
    const client = new Client({ name: 't', version: '0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${httpPort}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    clients.push(client);
    const out = await client.callTool({ name: 'world_info', arguments: {} });
    expect(out.isError).toBe(true);
    expect(JSON.stringify(out)).toContain('WORLD_OFFLINE');
  });

  it('an OAuth grant naming an offline agent still binds it', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const { linkPort, httpPort } = await ports();
    const seed = openStore(state.db);
    seed.createPairing({
      id: 'pair1',
      tokenHash: createHash('sha256').update('p'.repeat(40)).digest('hex'),
      worldId: W,
      userId: U,
      userName: 'Agent',
      origin: ORIGIN,
    });
    seed.headless.add({
      name: 'a1',
      foundryUrl: ORIGIN,
      worldId: W,
      userId: U,
      ownerUserId: null,
    });
    seed.close();
    const consent = new TestConsent();
    consent.next = () => ({ approve: { worldId: W, userId: U, scopes: ['read'] } });
    const publicUrl = `http://127.0.0.1:${httpPort}`;
    const app = createApp(
      { linkPort, httpPort, logLevel: 'error', publicUrl } as unknown as Config,
      {
        version: '0.0.0-test',
        dbPath: state.db,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        writeStatus: () => undefined,
        allowedOrigins: [ORIGIN],
        oauthConsent: consent,
      },
    );
    apps.push(app);
    await app.start();

    const redirect = 'http://127.0.0.1:9/callback';
    let info: OAuthClientInformationMixed | undefined;
    let saved: OAuthTokens | undefined;
    let verifier = '';
    let authUrl: URL | undefined;
    const provider: OAuthClientProvider = {
      redirectUrl: redirect,
      clientMetadata: {
        client_name: 'wiring test client',
        redirect_uris: [redirect],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      } as OAuthClientMetadata,
      clientInformation: () => info,
      saveClientInformation: (i) => void (info = i),
      tokens: () => saved,
      saveTokens: (t) => void (saved = t),
      redirectToAuthorization: (u) => void (authUrl = u),
      saveCodeVerifier: (v) => void (verifier = v),
      codeVerifier: () => verifier,
    };
    const url = new URL(`${publicUrl}/mcp`);
    const first = new StreamableHTTPClientTransport(url, { authProvider: provider });
    const c1 = new Client({ name: 'o', version: '0' });
    clients.push(c1);
    await expect(c1.connect(first)).rejects.toBeInstanceOf(UnauthorizedError);
    const res = await fetch(authUrl!, { redirect: 'manual' });
    await first.finishAuth(new URL(res.headers.get('location')!).searchParams.get('code')!);
    const authed = new Client({ name: 'o', version: '0' });
    clients.push(authed);
    await authed.connect(new StreamableHTTPClientTransport(url, { authProvider: provider }));

    const out = await authed.callTool({ name: 'world_info', arguments: {} });
    expect(out.isError).toBe(true);
    // Bound to the granted agent (offline), not filtered out of the pool.
    expect(JSON.stringify(out)).toContain('WORLD_OFFLINE');
    expect(JSON.stringify(out)).toContain('A pairing already exists');
  });
});
