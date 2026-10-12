/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { inertTableText } from '../../../src/tools/table-roll.js';
// Actual Chromium proof, independent of Foundry and any world/session. All requests are blocked.
const browser = await chromium.launch({
  channel: process.env.AGENT_GATEWAY_E2E_CHANNEL ?? 'chrome',
  headless: true,
});
try {
  const context = await browser.newContext();
  const requests: string[] = [];
  await context.route('**/*', (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  await page.evaluate(() => {
    (globalThis as any).executed = 0;
    customElements.define(
      'ag-inert-probe',
      class extends HTMLElement {
        constructor() {
          super();
          (globalThis as any).executed++;
        }
      },
    );
  });
  const text = await page.evaluate(
    inertTableText,
    '<b>A &amp; B</b><img src="https://invalid.example/image" onerror="executed++"><iframe src="https://invalid.example/frame"></iframe><script>executed++</script><ag-inert-probe></ag-inert-probe><svg onload="executed++"></svg>',
  );
  assert.match(text, /A & B/);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => (globalThis as any).executed), 0);
  assert.deepEqual(requests, []);
  console.log(
    'Task25 inert text Chromium PASS: entities retained; zero requests/scripts/custom-element execution',
  );
} finally {
  await browser.close();
}
