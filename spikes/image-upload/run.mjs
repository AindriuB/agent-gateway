// Usage: node run.mjs <v13|v14> <user> <probe.mjs>   (probe exports default async (page, ctx) => json)
// Joins the world with an empty password. Reads FOUNDRY_URL / AGENT_GATEWAY_E2E_V13_URL from env.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const require = createRequire(resolve(process.cwd(), '../../package.json'));
const { chromium } = require('playwright-core');
const [ver, user, probe] = process.argv.slice(2);
const base = (ver === 'v13' ? process.env.AGENT_GATEWAY_E2E_V13_URL : process.env.FOUNDRY_URL).replace(/\/$/, '');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('pageerror', String(e).slice(0, 200)));
  await page.goto(base + '/join', { timeout: 30000 });
  const sel = 'select:is([name="userId"], [name="userid"])';
  await page.waitForSelector(sel, { timeout: 20000 });
  await page.selectOption(sel, { label: user });
  await page.click('button[name="join"]');
  await page.waitForFunction('globalThis.game?.ready === true', null, { timeout: 60000 });
  const mod = await import(pathToFileURL(resolve(probe)).href);
  const out = await mod.default(page, { ver, user, base });
  console.log(JSON.stringify(out, null, 1));
} finally {
  await browser.close();
}
