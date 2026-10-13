// Started by the MCP Inspector in place of the gateway: runs the real gateway CLI but holds the
// client's requests back until the fake module has paired and announced its tools (the file named
// by CONFORMANCE_READY_FILE), so tools/list does not race the link handshake.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [cli, ...args] = process.argv.slice(2);
const readyFile = process.env.CONFORMANCE_READY_FILE;
const child = spawn(process.execPath, [cli, ...args], { stdio: ['pipe', 'inherit', 'inherit'] });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 1));

const deadline = Date.now() + 15_000;
while (!existsSync(readyFile) && Date.now() < deadline) await sleep(20);
await sleep(150); // the gateway processes the toolset frame after it arrives
process.stdin.pipe(child.stdin);
