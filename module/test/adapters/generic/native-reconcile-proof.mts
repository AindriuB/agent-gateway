/* eslint-disable @typescript-eslint/no-explicit-any */
/** Read-only evidence recovery. Never opens a gateway or calls a module tool. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildSync } from 'esbuild';
import { loadContext } from '../../../../e2e/lib/context.js';
import { openUserBrowser, joinWorld, asJoinPage } from '../../../../e2e/lib/browser.js';
import { TASK31_NATIVE_PINS, task31AuditRows, task31OnceRecord } from './native-plan.js';
import { task31Reconcile } from './native-reconcile.js';
const evidence = process.env.AGENT_GATEWAY_TASK31_RECONCILE;
if (!evidence || !/^\/private\/tmp\/task31-native-v(13|14)-[a-f0-9]{12}$/.test(evidence))
  throw Error('Exact private evidence path required');
const read = (name: string) => JSON.parse(readFileSync(resolve(evidence, name), 'utf8'));
const saved = read('baseline.json'),
  created = read('created.json'),
  plan = read('plan.json'),
  failed = read('result.json'),
  generation = evidence.includes('-v13-') ? 13 : 14;
if (failed.complete !== false || failed.cleaned !== true || failed.teardownErrors.length)
  throw Error('Only previously cleaned failed proof may reconcile');
const { config, paths } = loadContext(),
  root = fileURLToPath(new URL('../../../../', import.meta.url));
if (
  config.foundryOrigin !==
    (generation === 13 ? 'https://foundry13.local' : 'https://foundry.local') ||
  config.world !== 'test-world'
)
  throw Error('Exact read-only target required');
const bundle = readFileSync(resolve(root, 'dist/module/main.js'));
const registration = buildSync({
  entryPoints: [resolve(root, 'module/test/adapters/generic/native-reconcile-registration.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  write: false,
  keepNames: false,
}).outputFiles[0]!.text;
if (createHash('sha256').update(bundle).digest('hex') !== TASK31_NATIVE_PINS.bundle)
  throw Error('Frozen bundle changed');
const awaiting = [read('awaiting-0.json'), read('awaiting-1.json')],
  ids = awaiting.map((a) => a.id),
  calls = read('calls.json'),
  frames = read('frames.json');
if (
  ids[0] === ids[1] ||
  calls.length !== 6 ||
  calls.some((c: any) => !c.terminal) ||
  frames.some((f: any) => f.message.type === 'queuedCalls')
)
  throw Error('Original terminal capture mismatch');
const browser = await openUserBrowser(config, paths, config.gmUser, { headed: true });
try {
  await browser.context.routeWebSocket(
    (url) =>
      !(
        url.origin === config.foundryOrigin.replace(/^https:/, 'wss:') &&
        /^\/socket.io\/?$/.test(url.pathname)
      ),
    (route) => route.close(),
  );
  await browser.context.route('**/modules/agent-gateway/dist/module/main.js*', (route) =>
    route.fulfill({ body: registration, contentType: 'text/javascript' }),
  );
  await joinWorld(asJoinPage(browser.page), config, config.gmUser);
  await browser.page.waitForFunction('game.ready && !canvas.loading');
  const recovered = await browser.page.evaluate(task31Reconcile, {
    ...saved,
    generation,
    created,
    ids,
  });
  writeFileSync(resolve(evidence, 'reconciled-raw.json'), JSON.stringify(recovered, null, 2), {
    mode: 0o600,
  });
  task31AuditRows(recovered.rows, plan, created, saved.baseline.gm.id, awaiting[0].row.agentId);
  recovered.records.forEach((r: any, i: number) =>
    task31OnceRecord(r, plan.calls[i + 4], saved.baseline.gm.name, awaiting[0].row.agentId),
  );
  writeFileSync(
    resolve(evidence, 'reconciled-acceptance.json'),
    JSON.stringify(
      {
        ...recovered,
        originalResultPreserved: true,
        recordedCaptureChecks: [
          'six SDK calls terminal',
          'two unique native approval IDs',
          'no queuedCalls in saved frames',
        ],
        originalCaptureErrorEvidence: 'unavailable; original final assertion not reached',
        source: TASK31_NATIVE_PINS.source,
        bundle: TASK31_NATIVE_PINS.bundle,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
} finally {
  await browser.context.close();
}
