import { createRequire } from 'node:module'; import { resolve } from 'node:path';
const { chromium } = createRequire(resolve('../../package.json'))('playwright-core');
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await b.newContext({ ignoreHTTPSErrors: true })).newPage();
const r = await p.goto(process.env.AGENT_GATEWAY_E2E_V13_URL.replace(/\/$/, '') + '/join');
await p.waitForTimeout(6000);
console.log(r.status(), p.url().replace(/^https?:\/\/[^/]+/, ''), await p.title(), (await p.innerText('body')).slice(0, 300));
await b.close();
