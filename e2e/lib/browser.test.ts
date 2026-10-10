import { describe, expect, it } from 'vitest';
import { bannerScript, joinWorld, launchOptions, SELECTORS, type JoinPage } from './browser.js';
import { loadE2eConfig } from './config.js';

function fakePage(url = 'https://foundry.local/join') {
  const calls: Array<[string, ...unknown[]]> = [];
  const page: JoinPage = {
    goto: async (u) => void calls.push(['goto', u]),
    selectOption: async (s, o) => void calls.push(['select', s, o.label]),
    fill: async (s, v) => void calls.push(['fill', s, v]),
    click: async (s) => void calls.push(['click', s]),
    waitForSelector: async (s) => void calls.push(['wait', s]),
    waitForFunction: async () => void calls.push(['ready']),
    url: () => url,
  };
  return { page, calls };
}

describe('joinWorld', () => {
  it('selects the user, joins, and does not fill a password when none is set', async () => {
    const { page, calls } = fakePage();
    await joinWorld(page, loadE2eConfig({ env: {} }), 'player1');
    expect(calls.map((c) => c[0])).toEqual(['goto', 'wait', 'select', 'click', 'ready']);
    expect(calls).toContainEqual(['select', 'select[name="userId"]', 'player1']);
    expect(calls).toContainEqual(['click', 'button[name="join"]']);
  });

  it('fills the password only when FOUNDRY_PASSWORD is set', async () => {
    const { page, calls } = fakePage();
    await joinWorld(page, loadE2eConfig({ env: { FOUNDRY_PASSWORD: 'pw' } }), 'dev-gm');
    expect(calls).toContainEqual(['fill', SELECTORS.joinPassword, 'pw']);
  });

  it('skips the form when a session already exists', async () => {
    const { page, calls } = fakePage('https://foundry.local/game');
    await joinWorld(page, loadE2eConfig({ env: {} }), 'dev-gm');
    expect(calls.map((c) => c[0])).toEqual(['goto', 'ready']);
  });
});

describe('launchOptions', () => {
  it('uses CHROME_PATH when set, else the chrome channel', () => {
    expect(launchOptions(false, { CHROME_PATH: '/x/chrome' })).toMatchObject({
      executablePath: '/x/chrome',
      headless: true,
    });
    const o = launchOptions(true, {});
    expect(o).toMatchObject({ channel: 'chrome', headless: false, ignoreHTTPSErrors: false });
    expect(o.executablePath).toBeUndefined();
  });
});

describe('bannerScript', () => {
  it('shows the user and the code in the banner and the title', () => {
    const s = bannerScript('player1', 'CODE-42');
    expect(s).toContain('player1');
    expect(s).toContain('CODE-42');
    expect(s).toContain('document.title');
    expect(s).toContain('ag-e2e-banner');
  });
});
