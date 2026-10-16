// Local reproduction for task 108: one idle link client behind caddy:2 for N minutes, optionally
// with a Caddy reload part-way. Not part of the default e2e run. Usage:
//   node e2e/link-idle/idle.mjs <minutes> <reloadAtMinutes|-> <linkPort> <caddyPort> <adminPort> <name>
// The server mimics the gateway heartbeat (JSON ping every 15 s, terminate after 2 missed pongs).
import { WebSocketServer, WebSocket } from 'ws';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [minutes, reloadAt, linkPort, caddyPort, adminPort, name] = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), 'link-idle-'));
const here = new URL('.', import.meta.url).pathname;
const render = (mark) =>
  readFileSync(join(here, 'Caddyfile.tmpl'), 'utf8')
    .replace('__ADMIN__', adminPort)
    .replace('__PORT__', caddyPort)
    .replace('__LINK__', linkPort)
    .replace('__MCP__', String(Number(linkPort) + 1))
    .replace('__MARK__', mark);
const cf = join(dir, 'Caddyfile');
writeFileSync(cf, render(''));
const docker = (...a) => execFileSync('docker', a, { encoding: 'utf8' });
docker(
  'run',
  '-d',
  '--rm',
  '--name',
  name,
  '--network',
  'host',
  '-v',
  `${dir}:/etc/caddy:ro`,
  'caddy:2',
);

const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const wss = new WebSocketServer({ host: '127.0.0.1', port: Number(linkPort) });
let drops = 0;
wss.on('connection', (ws) => {
  let missed = 0;
  ws.on('message', () => (missed = 0));
  const iv = setInterval(() => {
    if (missed >= 2) {
      log('server: heartbeat terminate');
      ws.terminate();
      return;
    }
    missed++;
    ws.send('{"type":"ping"}');
  }, 15000);
  ws.on('close', (code) => {
    clearInterval(iv);
    drops++;
    log(`server: close code ${code}`);
  });
});
await new Promise((r) => setTimeout(r, 2500));
const ws = new WebSocket(`ws://127.0.0.1:${caddyPort}/link`);
ws.on('open', () => log('client: open'));
ws.on('message', () => ws.send('{"type":"pong"}'));
ws.on('close', (c) => log(`client: close ${c}`));
if (reloadAt !== '-') {
  setTimeout(
    () => {
      writeFileSync(cf, render('header X-Reloaded yes'));
      log(
        'reload: ' +
          docker('exec', name, 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile').trim() +
          ' (done)',
      );
    },
    Number(reloadAt) * 60000,
  );
}
setTimeout(
  () => {
    log(`done: server saw ${drops} close(s); client state ${ws.readyState}`);
    try {
      docker('stop', name);
    } catch {}
    process.exit(0);
  },
  Number(minutes) * 60000,
);
