import { describe, expect, it } from 'vitest';
import {
  bannerScript,
  joinWorld,
  launchOptions,
  matchUserName,
  SELECTORS,
  type JoinPage,
} from './browser.js';
import { loadE2eConfig } from './config.js';

function fakePage(url = 'https://foundry.local/join', options = ['dev-gm', 'player1', 'Player2']) {
  const calls: Array<[string, ...unknown[]]> = [];
  const page: JoinPage = {
    optionLabels: async () => options,
    goto: async (u, o) => void calls.push(['goto', u, o?.timeout]),
    selectOption: async (s, o) => void calls.push(['select', s, o.label]),
    fill: async (s, v) => void calls.push(['fill', s, v]),
    click: async (s) => void calls.push(['click', s]),
    waitForSelector: async (s, o) => void calls.push(['wait', s, o?.timeout]),
    waitForFunction: async (_f, _a, o) => void calls.push(['ready', o?.timeout]),
    url: () => url,
  };
  return { page, calls };
}

describe('joinWorld', () => {
  it('caps every wait by the time it is given', async () => {
    const { page, calls } = fakePage();
    await joinWorld(page, loadE2eConfig({ env: {} }), 'player1', 7_000);
    const timeouts = calls
      .filter((c) => c[0] === 'goto' || c[0] === 'wait' || c[0] === 'ready')
      .map((c) => c[c.length - 1] as number);
    expect(timeouts).toHaveLength(3);
    for (const t of timeouts) expect(t).toBeLessThanOrEqual(7_000);
  });

  it('selects the user, joins, and does not fill a password when none is set', async () => {
    const { page, calls } = fakePage();
    await joinWorld(page, loadE2eConfig({ env: {} }), 'player1');
    expect(calls.map((c) => c[0])).toEqual(['goto', 'wait', 'select', 'click', 'ready']);
    expect(calls).toContainEqual(['select', SELECTORS.joinUser, 'player1']);
    expect(calls).toContainEqual(['click', 'button[name="join"]']);
  });

  it('fills the password only when FOUNDRY_PASSWORD is set', async () => {
    const { page, calls } = fakePage();
    await joinWorld(page, loadE2eConfig({ env: { FOUNDRY_GM_PASSWORD: 'pw' } }), 'dev-gm');
    expect(calls).toContainEqual(['fill', SELECTORS.joinPassword, 'pw']);
    // Another user's join does not get the GM's password.
    const other = fakePage();
    await joinWorld(other.page, loadE2eConfig({ env: { FOUNDRY_GM_PASSWORD: 'pw' } }), 'player1');
    expect(other.calls.some((c) => c[0] === 'fill')).toBe(false);
  });

  it('skips the form when a session already exists', async () => {
    const { page, calls } = fakePage('https://foundry.local/game');
    await joinWorld(page, loadE2eConfig({ env: {} }), 'dev-gm');
    expect(calls.map((c) => c[0])).toEqual(['goto', 'ready']);
  });
});

describe('user name matching', () => {
  it('prefers an exact match, then a case-insensitive one', () => {
    expect(matchUserName('player2', ['Player2', 'player2'])).toBe('player2');
    expect(matchUserName('player2', ['dev-gm', 'Player2'])).toBe('Player2');
    expect(matchUserName('nobody', ['dev-gm'])).toBeUndefined();
    expect(matchUserName('bob', ['Bob', 'BOB'])).toBeUndefined();
  });
  it('joins as the real-case name', async () => {
    const { page, calls } = fakePage();
    await joinWorld(page, loadE2eConfig({ env: {} }), 'player2');
    expect(calls).toContainEqual(['select', SELECTORS.joinUser, 'Player2']);
  });
  it('lists the available users when there is no match', async () => {
    const { page } = fakePage();
    await expect(joinWorld(page, loadE2eConfig({ env: {} }), 'ghost')).rejects.toThrow(
      /no Foundry user "ghost".*available users: dev-gm, player1, Player2/,
    );
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
