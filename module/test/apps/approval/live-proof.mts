/* eslint-disable @typescript-eslint/no-explicit-any */
/** Run explicitly with the existing E2E v14 environment. No pairing or world writes. */
import { build } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadContext } from '../../../../e2e/lib/context.js';
import { openUserBrowser, joinWorld, asJoinPage } from '../../../../e2e/lib/browser.js';
import { liveGateway } from './live-gateway.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const out = '/private/tmp/agent-gateway-task17-fixture-bundle';
await build({
  root: resolve(root, 'module'),
  configFile: resolve(root, 'module/vite.config.ts'),
  plugins: [
    {
      name: 'approval-fixture-only',
      transform(source, id) {
        if (id === resolve(root, 'module/src/main.ts'))
          return `import ${JSON.stringify(resolve(root, 'module/test/apps/approval/live-fixture.ts'))};\n${source}`;
      },
    },
  ],
  build: { outDir: out, emptyOutDir: true },
});
const bundle = readFileSync(`${out}/main.js`);
const sha = createHash('sha256').update(bundle).digest('hex');
const { config, paths } = loadContext();
const gateway = await liveGateway(config, paths);
const browser = await openUserBrowser(config, paths, config.gmUser, { headed: true }).catch(
  async (error) => {
    await gateway.stop();
    throw error;
  },
);
const served: string[] = [];
const errors: string[] = [];
browser.page.on('pageerror', (err) => errors.push(err.message));
const evidenceDir = resolve(root, 'module/test/apps/approval/evidence');
mkdirSync(evidenceDir, { recursive: true });
try {
  for (const [pattern, path, contentType] of [
    ['**/modules/agent-gateway/dist/module/main.js*', `${out}/main.js`, 'text/javascript'],
    ['**/modules/agent-gateway/lang/en.json*', `${root}/lang/en.json`, 'application/json'],
    [
      '**/modules/agent-gateway/styles/agent-gateway.css*',
      `${root}/styles/agent-gateway.css`,
      'text/css',
    ],
  ])
    await browser.context.route(pattern!, async (route) => {
      served.push(path!);
      await route.fulfill({ path, contentType });
    });
  await joinWorld(asJoinPage(browser.page), config, config.gmUser);
  for (let i = 0; i < 30; i++) {
    const info = await gateway.call('world_info');
    if (!info.isError) break;
    if (i === 29) throw Error(info.text);
    await browser.page.waitForTimeout(1000);
  }
  console.log('Authenticated MCP core connection ready');
  await browser.page.evaluate(
    ({ path, source }) => {
      // Foundry loads native HBS through sockets, so preload its real native partial cache.
      const h = (globalThis as any).Handlebars;
      h.registerPartial(path, h.compile(source));
    },
    {
      path: 'modules/agent-gateway/templates/approval/approval.hbs',
      source: readFileSync(resolve(root, 'templates/approval/approval.hbs'), 'utf8'),
    },
  );
  await browser.page.waitForFunction('canvas.ready === true', undefined, { timeout: 20000 });
  const facts = await browser.page.evaluate(
    '({version:game.version,user:game.user.name,isGM:game.user.isGM,world:game.world.id,active:game.modules.get("agent-gateway")?.active})',
  );
  if (!facts.isGM || !facts.active || !served.includes(`${out}/main.js`))
    throw Error('Actual GM/core route not verified');
  const version = String(facts.version).startsWith('13.') ? 'v13' : 'v14';
  const beforeJournals = await browser.page.evaluate(
    'JSON.stringify(game.journal.map(j=>j.toObject()))',
  );
  const actor = await browser.page.evaluate('game.actors.get("6i6mZ5g8vX8iU9RD")?.toObject()');
  if (!actor) throw Error('Expected owned test actor is missing');
  const beforeActors = await browser.page.evaluate(
    'JSON.stringify(game.actors.map(a=>a.toObject()))',
  );
  const app = browser.page.locator('#agent-gateway-approval');
  const update = gateway.call('document_update', {
    uuid: 'Actor.6i6mZ5g8vX8iU9RD',
    update: JSON.stringify({ name: 'approval-preview-only' }),
  });
  await app.locator('article').waitFor({ timeout: 10000 });
  const diff = await app.locator('table').innerText();
  if (
    !diff.includes('name') ||
    !diff.includes(actor.name) ||
    !diff.includes('approval-preview-only')
  )
    throw Error('Native document diff missing');
  await app.evaluate((el) => {
    (el as HTMLElement).style.top = '60px';
  });
  await app.screenshot({ path: resolve(evidenceDir, `${version}-document-diff.png`) });
  await app.locator('[data-action="approve"]').click();
  const accepted = await update;
  if (accepted.isError || accepted.structured?.accepted !== true)
    throw Error(`Approved MCP fixture failed: ${accepted.text}`);
  await app.waitFor({ state: 'hidden' });

  const malicious = '<img src=x onerror=alert(1)>';
  const pack = gateway.call('fixture-review', { html: malicious });
  await app.locator('article').waitFor({ timeout: 10000 });
  const text = await app.innerText();
  if (
    !text.includes('Third-party tool pack') ||
    !text.includes('approval-fixture-pack') ||
    !text.includes('0.0.0-test') ||
    !text.includes(malicious) ||
    (await app.locator('img,script,[onerror],[onload],[onclick]').count())
  )
    throw Error('Native pack text escaped/provenance assertion failed');
  await app.locator('textarea').fill('Fixture denial reason reaches the MCP caller');
  await app.screenshot({ path: resolve(evidenceDir, `${version}-pack-denial.png`) });
  await app.locator('[data-action="deny"]').click();
  const denied = await pack;
  if (!denied.isError || !denied.text.includes('Fixture denial reason reaches the MCP caller'))
    throw Error('MCP denial reason missing');
  await app.waitFor({ state: 'hidden' });

  const source = Array.from({ length: 500 }, (_, i) => `// source line ${i + 1}`).join('\n');
  const code = gateway.call('fixture_code', { source });
  await app.locator('.ag-approval-code').waitFor({ timeout: 10000 });
  if (
    (await app.locator('.ag-approval-code').textContent()) !== source ||
    (await app.locator('[data-action="session"]').count())
  )
    throw Error('Full code display/session restriction failed');
  await app.screenshot({ path: resolve(evidenceDir, `${version}-code.png`) });
  await app.locator('[data-action=\"deny\"]').scrollIntoViewIfNeeded();
  await app.screenshot({ path: resolve(evidenceDir, `${version}-code-end.png`) });
  await app.locator('textarea').fill('Code fixture is review only');
  await app.locator('[data-action="deny"]').click();
  if (!(await code).isError) throw Error('Code fixture should be denied');
  await app.waitFor({ state: 'hidden' });
  const groupedA = gateway.call('document_update', {
    uuid: 'Actor.6i6mZ5g8vX8iU9RD',
    update: JSON.stringify({ name: 'batch-preview-one' }),
  });
  const groupedB = gateway.call('document_update', {
    uuid: 'Actor.6i6mZ5g8vX8iU9RD',
    update: JSON.stringify({ name: 'batch-preview-two' }),
  });
  await browser.page.waitForFunction(
    'document.querySelectorAll("#agent-gateway-approval article").length === 2',
  );
  if ((await app.locator('[data-action="approveAll"]').count()) !== 1)
    throw Error('Same-session requests were not grouped');
  await app.evaluate((el) => {
    for (const node of [el, ...el.querySelectorAll('*')])
      if (node instanceof HTMLElement) node.scrollTop = 0;
  });
  await app.screenshot({ path: resolve(evidenceDir, `${version}-batch.png`) });
  await app.locator('[data-action="approveAll"]').click();
  for (const result of await Promise.all([groupedA, groupedB]))
    if (result.isError || result.structured?.accepted !== true)
      throw Error('Grouped MCP fixture approval failed');
  const afterJournals = await browser.page.evaluate(
    'JSON.stringify(game.journal.map(j=>j.toObject()))',
  );
  if (beforeJournals !== afterJournals) throw Error('Fixture changed audit/world journals');
  const afterActors = await browser.page.evaluate(
    'JSON.stringify(game.actors.map(a=>a.toObject()))',
  );
  if (beforeActors !== afterActors) throw Error('Fixture changed world actors');
  if (errors.length) throw Error(`Browser errors: ${errors.join('; ')}`);
  console.log(
    JSON.stringify({
      status: 'PASS',
      facts,
      bundleSha: sha,
      served,
      assertions: [
        'real MCP approval',
        'current document diff',
        'escaped pack fixture provenance',
        'MCP denial reason',
        'full 500-line code',
        'real MCP grouped approval',
        'world actors and journals unchanged',
      ],
      productionBundle: false,
      noOpFixture: true,
      auditSink: 'local no-op',
      screenshots: evidenceDir,
    }),
  );
} catch (error) {
  console.log(JSON.stringify({ status: 'FAIL', browserErrors: errors, served }));
  throw error;
} finally {
  await browser.close();
  await gateway.stop();
}
