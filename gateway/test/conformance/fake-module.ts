// Fake Foundry module for scripts/conformance.sh. Run through tsx:
//   fake-module.ts pair <dbPath> <port> <tokenFile>   pair once, store the token
//   fake-module.ts serve <port> <tokenFile> <readyFile> [codeFile]  stay connected, answer calls;
//                                                     writes the consent code (task 67) to codeFile
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, TOOLS, toJsonSchema } from '@agent-gateway/protocol';
import { LinkRegistry, LinkServer, PairingCodes } from '../../src/link/index.js';
import { openStore } from '../../src/store/index.js';

export const ORIGIN = 'http://localhost:30000';

export const FIXTURE_PACK_TOOL = {
  name: 'demo-echo',
  category: 'read',
  minRole: 'player',
  description: 'Conformance fixture pack tool that echoes its input.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { value: { type: 'string', description: 'Value to echo' } },
    required: ['value'],
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { value: { type: 'string', description: 'Echoed value' } },
  },
  pack: { id: 'demo-pack', version: '1.0.0', prefix: 'demo' },
};

/** What a real module announces for core: every module-handled definition, as JSON Schema. */
export const coreAnnouncements = () =>
  TOOLS.filter((t) => t.handledBy === 'module').map((t) => ({
    name: t.name,
    description: t.description,
    category: t.category,
    minRole: t.minRole,
    ...toJsonSchema(t),
  }));

export const hello = (auth: unknown) => ({
  type: 'hello',
  protocolVersion: PROTOCOL_VERSION,
  moduleVersion: '0.0.0',
  foundryVersion: '14.0',
  world: { id: 'conf', title: 'Conformance', system: 'pf2e', systemVersion: '1' },
  user: { id: 'gm', name: 'gm', role: 4, isGM: true },
  auth,
});

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: ORIGIN });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

async function pair(dbPath: string, port: number, tokenFile: string): Promise<void> {
  const store = openStore(dbPath);
  const codes = new PairingCodes();
  const server = new LinkServer({
    port,
    store,
    codes,
    registry: new LinkRegistry(),
    allowedOrigins: [ORIGIN],
    gatewayVersion: '0.0.0-conformance',
  });
  await server.listen();
  const ws = await connect(port);
  const token = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('pairing timed out after 10s')), 10_000);
    const fail = (err: Error) => {
      clearTimeout(timer);
      reject(err);
    };
    ws.once('close', () => fail(new Error('link closed before pairing completed')));
    ws.once('error', fail);
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as { type: string; pairingToken?: string };
      if (m.type === 'welcome' && m.pairingToken) {
        clearTimeout(timer);
        resolve(m.pairingToken);
      } else if (m.type === 'reject') fail(new Error('pairing rejected'));
    });
    ws.send(JSON.stringify(hello({ kind: 'pairingCode', code: codes.generate() })));
  });
  writeFileSync(tokenFile, token, { mode: 0o600 });
  ws.terminate();
  await server.close();
  store.close();
}

async function serveOnce(
  port: number,
  token: string,
  readyFile: string,
  codeFile?: string,
): Promise<void> {
  const ws = await connect(port);
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString()) as {
      type: string;
      id?: string;
      code?: string;
      args?: { value?: string };
    };
    if (m.type === 'consentCode') {
      // The user's Foundry client shows this code; the OAuth conformance flow reads it from here.
      if (codeFile && m.code) writeFileSync(codeFile, m.code, { mode: 0o600 });
    } else if (m.type === 'welcome') {
      ws.send(JSON.stringify({ type: 'eventPolicy', enabled: true, retentionDays: 7 }));
      ws.send(
        JSON.stringify({
          type: 'toolset',
          eventReadAllowed: true,
          tools: [...coreAnnouncements(), FIXTURE_PACK_TOOL],
        }),
      );
      // The gateway handles frames in order, so its pong to this ping means the toolset is applied.
      ws.send(JSON.stringify({ type: 'ping' }));
    } else if (m.type === 'pong') {
      // Tells gateway-wrapper.mjs it may start forwarding the client's requests.
      writeFileSync(readyFile, 'ready');
    } else if (m.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    } else if (m.type === 'call') {
      const value = m.args?.value ?? '';
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
  ws.send(JSON.stringify(hello({ kind: 'pairingToken', token })));
  await new Promise<void>((resolve) => ws.once('close', () => resolve()));
  rmSync(readyFile, { force: true });
}

/** The gateway is started afresh by each inspector run, so reconnect until killed. */
async function serve(
  port: number,
  tokenFile: string,
  readyFile: string,
  codeFile?: string,
): Promise<void> {
  const token = readFileSync(tokenFile, 'utf8');
  for (;;) {
    try {
      await serveOnce(port, token, readyFile, codeFile);
    } catch {
      // gateway not listening yet
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, a, b, c, d] = process.argv.slice(2);
  if (mode === 'pair' && a && b && c) await pair(a, Number(b), c);
  else if (mode === 'serve' && a && b && c) await serve(Number(a), b, c, d);
  else {
    process.stderr.write(
      'usage: fake-module.ts pair <db> <port> <tokenFile> | serve <port> <tokenFile> <readyFile> [codeFile]\n',
    );
    process.exit(2);
  }
}
