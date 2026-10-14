import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { createApp, type App } from '../../src/app.js';
import { openStore } from '../../src/store/index.js';
import { createHash } from 'node:crypto';
import { ORIGIN, TestClient, hello } from '../link/helpers.js';
import { freePort, tempState } from '../relay/harness.js';
import { TestConsent } from '../oauth/helpers.js';

/** An in-memory OAuthClientProvider that captures the authorization URL instead of opening it. */
class Provider implements OAuthClientProvider {
  info: OAuthClientInformationMixed | undefined;
  saved: OAuthTokens | undefined;
  verifier = '';
  authUrl: URL | undefined;
  constructor(readonly redirect: string) {}
  get redirectUrl(): string {
    return this.redirect;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'sdk test client',
      redirect_uris: [this.redirect],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    };
  }
  clientInformation = () => this.info;
  saveClientInformation = (i: OAuthClientInformationMixed) => {
    this.info = i;
  };
  tokens = () => this.saved;
  saveTokens = (t: OAuthTokens) => {
    this.saved = t;
  };
  redirectToAuthorization = (u: URL) => {
    this.authUrl = u;
  };
  saveCodeVerifier = (v: string) => {
    this.verifier = v;
  };
  codeVerifier = () => this.verifier;
}

const apps: App[] = [];
const cleanups: (() => void)[] = [];
const clients: Client[] = [];
const modules: TestClient[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close().catch(() => undefined)));
  modules.splice(0).forEach((m) => m.ws.terminate());
  for (const a of apps.splice(0)) await a.stop();
  for (const c of cleanups.splice(0)) c();
});

describe('the MCP SDK OAuth client against a public gateway', () => {
  it('registers, authorizes, gets a token, lists tools and calls one (scopes enforced)', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const linkPort = await freePort();
    let httpPort = await freePort();
    while (httpPort === linkPort) httpPort = await freePort();
    // Pair (w1, u1) in advance: a public gateway shows no pairing code to a script.
    const seed = openStore(state.db);
    const pairingToken = 'p'.repeat(40);
    seed.createPairing({
      id: 'pair1',
      tokenHash: createHash('sha256').update(pairingToken).digest('hex'),
      worldId: 'w1',
      userId: 'u1',
      userName: 'U One',
      origin: ORIGIN,
    });
    seed.close();

    const consent = new TestConsent();
    consent.next = () => ({ approve: { worldId: 'w1', userId: 'u1', scopes: ['read'] } });
    const publicUrl = `http://127.0.0.1:${httpPort}`;
    const lines: string[] = [];
    const app = createApp(
      { linkPort, httpPort, logLevel: 'error', publicUrl } as unknown as Parameters<
        typeof createApp
      >[0],
      {
        version: '0.0.0-test',
        dbPath: state.db,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        writeStatus: (l) => lines.push(l),
        allowedOrigins: [ORIGIN],
        oauthConsent: consent,
      },
    );
    apps.push(app);
    await app.start();

    const module = await TestClient.connect(linkPort, ORIGIN);
    modules.push(module);
    module.send(hello({ kind: 'pairingToken', token: pairingToken }));
    await module.next('welcome');

    const provider = new Provider('http://127.0.0.1:9/callback');
    const url = new URL(`${publicUrl}/mcp`);
    const first = new StreamableHTTPClientTransport(url, { authProvider: provider });
    const client = new Client({ name: 'sdk', version: '0' });
    clients.push(client);
    // Discovery, registration and the authorization redirect all happen inside connect().
    await expect(client.connect(first)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(provider.info).toBeDefined();
    expect(provider.authUrl?.origin).toBe(publicUrl);
    expect(provider.authUrl?.searchParams.get('resource')).toBe(`${publicUrl}/mcp`);

    // The "browser": follow /authorize without following the redirect to the client.
    const res = await fetch(provider.authUrl!, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const back = new URL(res.headers.get('location')!);
    expect(`${back.origin}${back.pathname}`).toBe('http://127.0.0.1:9/callback');
    await first.finishAuth(back.searchParams.get('code')!);
    expect(provider.saved?.access_token).toBeTruthy();
    expect(consent.requests[0]?.clientName).toBe('sdk test client');

    const second = new StreamableHTTPClientTransport(url, { authProvider: provider });
    const authed = new Client({ name: 'sdk', version: '0' });
    clients.push(authed);
    await authed.connect(second);
    const tools = (await authed.listTools()).tools.map((t) => t.name);
    expect(tools).toContain('world_info');
    expect(tools).toContain('gateway_status');
    // A read-scoped token sees no write tool.
    expect(tools).not.toContain('chat_post');

    const result = authed.callTool({ name: 'world_info', arguments: {} });
    const frame = (await module.next('call')) as { id: string };
    const info = {
      worldId: 'w1',
      worldTitle: 'W',
      systemId: 'pf2e',
      systemVersion: '1',
      foundryGeneration: 14,
      userName: 'U One',
      userRole: 'GAMEMASTER',
      activeScene: '',
      combatActive: false,
    };
    module.send({ type: 'result', id: frame.id, ok: true, text: 'ok', structured: info });
    const out = await result;
    expect(out.isError).toBeFalsy();
    const denied = await authed.callTool({ name: 'chat_post', arguments: { content: 'hi' } });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied.content)).toContain('FORBIDDEN');

    // The static bearer is off: the stored-token machinery of local mode does not exist here.
    expect(lines.some((l) => l.includes('HTTP bearer token (shown once'))).toBe(false);
  });
});
