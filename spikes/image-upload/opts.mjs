import { createRequire } from 'node:module'; import { resolve } from 'node:path';
const { chromium } = createRequire(resolve('../../package.json'))('playwright-core');
const b = await chromium.launch({ channel: 'chrome', headless: true });
for (const [n, u] of [['v14', process.env.FOUNDRY_URL], ['v13', process.env.AGENT_GATEWAY_E2E_V13_URL]]) {
  const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 } })).newPage();
  await p.goto(u.replace(/\/$/, '') + '/join'); await p.waitForSelector('select:is([name="userId"],[name="userid"])');
  console.log(n, await p.$$eval('select:is([name=userId],[name=userid]) option', os => os.map(o => `${o.textContent.trim()}${o.disabled ? ' (disabled)' : ''}`)));
}
await b.close();
