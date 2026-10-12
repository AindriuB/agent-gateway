/* eslint-disable @typescript-eslint/no-explicit-any */
/** Cleanup only. Requires the exact previously consented returned Actor UUID. No gateway starts. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { loadContext } from '../../../e2e/lib/context.js';
import { openUserBrowser, joinWorld, asJoinPage } from '../../../e2e/lib/browser.js';
import { task30RecoverCustody, task30NativeState } from './native-state.js';
import { TASK30_PINS } from './native-plan.js';
const evidence = process.env.AGENT_GATEWAY_TASK30_CLEANUP_EVIDENCE ?? '',
  approved = process.env.AGENT_GATEWAY_TASK30_CLEANUP_APPROVED ?? '';
if (
  !/^\/private\/tmp\/task30-native-v(13|14)-[a-f0-9]{12}$/.test(evidence) ||
  !/^Actor\.[A-Za-z0-9]{16}$/.test(approved)
)
  throw Error('Exact prior cleanup consent and local run evidence required');
const read = (name: string) => JSON.parse(readFileSync(resolve(evidence, name), 'utf8')),
  saved = read('baseline.json'),
  created = read('created.json'),
  manual = read('manual-reconciliation.json'),
  generation = Number(/-v(13|14)-/.exec(evidence)![1]),
  { config, paths } = loadContext(),
  sha = (data: Buffer) => createHash('sha256').update(data).digest('hex'),
  originalDbHash = sha(readFileSync(paths.db)),
  bundle = readFileSync(new URL('../../../dist/module/main.js', import.meta.url));
if (
  created.uuid !== approved ||
  manual.uuid !== approved ||
  manual.run !== saved.run ||
  saved.source !== TASK30_PINS.source ||
  saved.bundle !== TASK30_PINS.bundle ||
  sha(bundle) !== TASK30_PINS.bundle ||
  config.foundryOrigin !==
    (generation === 14 ? 'https://foundry.local' : 'https://foundry13.local') ||
  config.world !== 'test-world' ||
  config.linkPort !== (generation === 14 ? 7429 : 7439)
)
  throw Error('Exact failed-run cleanup target/pins required');
const db = new DatabaseSync(resolve(evidence, 'isolated.db'), { readOnly: true });
try {
  const rows = db.prepare('SELECT id,state,result FROM queued_calls').all();
  if (
    rows.length !== 2 ||
    rows.some((r) => !manual.ids.includes(r.id) || r.state !== 'unknown' || r.result !== null)
  )
    throw Error('Failed-run receipts must be terminal unknown; never restart replay');
} finally {
  db.close();
}
const browser = await openUserBrowser(config, paths, config.gmUser, { headed: true });
try {
  // Block the test gateway transport before navigation; the Foundry server socket remains available.
  await browser.context.routeWebSocket(
    (url) =>
      !(
        url.origin === config.foundryOrigin.replace(/^https:/, 'wss:') &&
        /^\/socket.io\/?$/.test(url.pathname)
      ),
    (route) => route.close(),
  );
  await browser.context.route('**/modules/agent-gateway/dist/module/main.js*', (route) =>
    route.fulfill({ body: bundle, contentType: 'text/javascript' }),
  );
  await joinWorld(asJoinPage(browser.page), config, config.gmUser);
  await browser.page.waitForFunction('game.ready && !canvas.loading');
  const input = {
    baseline: saved.baseline,
    created,
    plan: saved.plan,
    run: saved.run,
    generation,
    uuid: created.uuid,
    ids: manual.ids,
  };
  // Natural manager load expires unfinished records. This callback never changes an approval decision.
  await browser.page.waitForFunction(
    ({ ids }: any) => {
      const g = globalThis as any,
        raw = localStorage.getItem(`agent-gateway.${g.game.world.id}.approvalQueue`),
        rows = raw ? (JSON.parse(raw)[g.game.user.id] ?? []) : [];
      return ids.every((id: string) =>
        rows.some((r: any) => r.id === id && r.status === 'expired'),
      );
    },
    { ids: manual.ids },
    { timeout: 10000 },
  );
  const custody = await browser.page.evaluate(task30RecoverCustody, input);
  const audits = await browser.page.evaluate(task30NativeState, { ...input, op: 'audits' });
  if (audits.length) throw Error('Failed run added unexpected audit; no deletion');
  const facts = await browser.page.evaluate(task30NativeState, { ...input, op: 'facts' });
  const cleanup = await browser.page.evaluate(task30NativeState, { ...input, op: 'cleanup' });
  writeFileSync(
    resolve(evidence, 'reconciled-cleanup.json'),
    JSON.stringify({ custody, facts, audits, cleanup }, null, 2),
    { mode: 0o600 },
  );
  process.stdout.write(
    `TASK30_RECONCILED ${JSON.stringify({ uuid: created.uuid, cleaned: true, audits: 0 })}\n`,
  );
} finally {
  await browser.context.close();
  if (sha(readFileSync(paths.db)) !== originalDbHash)
    throw Error('Original credential database changed');
}
