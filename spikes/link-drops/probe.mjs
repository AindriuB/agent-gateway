// Task 155 probe: gap between a server `ping` and the page's `pong` under browser conditions.
// Usage: node spikes/link-drops/probe.mjs <scenario> [seconds]
//   scenario: baseline | hidden | frozen | blocked | discarded
// Needs Google Chrome (CHROME env var overrides the macOS default path) and the `ws` package.
// The page is a minimal stand-in for module/src/link/client.ts: it answers `ping` from a ws
// `message` handler, nothing else. Chrome is driven over raw CDP; no Foundry is required.
import { WebSocketServer, WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scenario = process.argv[2] ?? 'baseline';
const secs = Number(process.argv[3] ?? 60);
const PING_MS = 5000;
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
await new Promise((r) => wss.on('listening', r));
const wsPort = wss.address().port;
const gaps = []; // {sentAt, gapMs|null}
let pending = [];
wss.on('connection', (ws) => {
  log('server: page connected');
  ws.on('close', (c) => log(`server: socket closed ${c}`));
  ws.on('message', () => {
    const now = Date.now();
    for (const sentAt of pending) gaps.push({ sentAt, gap: now - sentAt });
    pending = [];
  });
  setInterval(() => {
    pending.push(Date.now());
    ws.send('{"type":"ping"}');
  }, PING_MS).unref();
});

const http = createServer((_, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(`<script>
  const ws = new WebSocket('ws://127.0.0.1:${wsPort}');
  ws.onmessage = () => ws.send('{"type":"pong"}');
  </script>`);
});
await new Promise((r) => http.listen(0, '127.0.0.1', r));
const httpPort = http.address().port;

const dir = mkdtempSync(join(tmpdir(), 'link-drops-'));
const proc = spawn(
  chrome,
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
const cdpUrl = await new Promise((resolve) => {
  proc.stderr.on('data', (d) => {
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(String(d));
    if (m) resolve(m[1]);
  });
});
const cdp = new WebSocket(cdpUrl);
await new Promise((r) => cdp.on('open', r));
let id = 0;
const waiting = new Map();
cdp.on('message', (d) => {
  const m = JSON.parse(String(d));
  if (m.id && waiting.has(m.id)) waiting.get(m.id)(m);
});
const call = (method, params = {}, sessionId) =>
  new Promise((resolve) => {
    const i = ++id;
    waiting.set(i, resolve);
    cdp.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
const { result } = await call('Target.createTarget', { url: `http://127.0.0.1:${httpPort}/` });
const targetId = result.targetId;
const att = await call('Target.attachToTarget', { targetId, flatten: true });
const sid = att.result.sessionId;
const page = (m, p) => call(m, p, sid);
await page('Page.enable');
await new Promise((r) => setTimeout(r, 3000));

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
log(`scenario ${scenario}, ${secs}s`);
if (scenario === 'hidden') {
  // A second target in front hides the first; emulation off so the page sees real visibility.
  await call('Target.createTarget', { url: 'about:blank', background: false });
  await call('Target.activateTarget', {
    targetId: (await call('Target.getTargets')).result.targetInfos.find(
      (t) => t.url === 'about:blank',
    )?.targetId,
  });
  await sleep(secs);
} else if (scenario === 'frozen') {
  await page('Page.setWebLifecycleState', { state: 'frozen' });
  log('page frozen');
  await sleep(secs);
  await page('Page.setWebLifecycleState', { state: 'active' });
  log('page resumed');
  await sleep(PING_MS / 1000 + 2);
} else if (scenario === 'blocked') {
  log('blocking main thread');
  await page('Runtime.evaluate', {
    expression: `(() => { const e = Date.now() + ${secs * 1000}; while (Date.now() < e); })()`,
  });
  log('unblocked');
  await sleep(PING_MS / 1000 + 2);
} else if (scenario === 'discarded') {
  // Closing the target is what a discard does to the socket; reported for completeness.
  await call('Target.closeTarget', { targetId });
  log('page closed (discard stand-in)');
  await sleep(secs);
} else await sleep(secs);

const done = gaps.map((g) => g.gap);
log(`pings answered: ${done.length}, unanswered: ${pending.length}`);
log(`gap ms: min ${Math.min(...done)} max ${Math.max(...done)}`);
console.log(
  JSON.stringify({
    scenario,
    secs,
    pingMs: PING_MS,
    maxGapMs: Math.max(...done, 0),
    unanswered: pending.length,
  }),
);
proc.kill();
process.exit(0);
