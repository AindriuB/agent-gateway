import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { LinkState } from '../../src/link/client.js';
import {
  createStatusIndicator,
  indicatorState,
  type IndicatorElement,
  type IndicatorRoot,
} from '../../src/link/status-indicator.js';

const states: [LinkState, boolean, string][] = [
  [{ kind: 'connected', user: 'u', world: 'w' }, true, 'connected'],
  [{ kind: 'connecting' }, true, 'reconnecting'],
  [{ kind: 'connecting', codeRejected: true }, true, 'reconnecting'],
  [{ kind: 'disconnected', reason: 'ERROR' }, true, 'reconnecting'],
  [{ kind: 'disconnected', reason: 'PAIRING_REQUIRED' }, true, 'needsPairing'],
  [{ kind: 'disconnected', reason: 'PAIRING_INVALID' }, true, 'needsPairing'],
  [{ kind: 'disconnected', reason: 'TOKEN_REJECTED' }, true, 'needsPairing'],
  [{ kind: 'disconnected', reason: 'REPLACED' }, true, 'elsewhere'],
  [{ kind: 'disconnected' }, true, 'hidden'],
  [{ kind: 'disconnected', reason: 'PROTOCOL_MAJOR_MISMATCH' }, true, 'hidden'],
  [{ kind: 'connected', user: 'u', world: 'w' }, false, 'hidden'],
  [{ kind: 'disconnected', reason: 'PAIRING_REQUIRED' }, false, 'hidden'],
];
it.each(states)('indicatorState(%j, inUse=%s) is %s', (s, inUse, want) => {
  expect(indicatorState(s, inUse)).toBe(want);
});

class El implements IndicatorElement {
  textContent: string | null = null;
  className = '';
  hidden = false;
  attrs: Record<string, string> = {};
  setAttribute(n: string, v: string) {
    this.attrs[n] = v;
  }
}
function rig(opts: { isGM?: boolean; stored?: boolean; state?: LinkState } = {}) {
  let state: LinkState = opts.state ?? { kind: 'connecting' };
  let listener: (s: LinkState) => void = () => {};
  const warn = vi.fn();
  const els: El[] = [];
  const row = { appendChild: vi.fn() };
  const root: IndicatorRoot = { querySelector: vi.fn(() => row) };
  const ind = createStatusIndicator({
    client: {
      get state() {
        return state;
      },
      onState: (fn) => {
        listener = fn;
        return () => {};
      },
      hasStoredToken: () => opts.stored ?? true,
    },
    isGM: () => opts.isGM ?? true,
    userId: () => 'u1',
    localize: (k) => `L:${k}`,
    warn,
    createElement: () => {
      const e = new El();
      els.push(e);
      return e;
    },
  });
  ind.render(root);
  const set = (s: LinkState) => {
    state = s;
    listener(s);
  };
  return { el: els[0]!, set, warn, row, root };
}

it('updates its text on state changes without another render', () => {
  const t = rig();
  expect(t.el.textContent).toBe('L:AGENT_GATEWAY.Link.Indicator.reconnecting');
  t.set({ kind: 'connected', user: 'a', world: 'b' });
  expect(t.el.textContent).toBe('L:AGENT_GATEWAY.Link.Indicator.connected');
  t.set({ kind: 'disconnected', reason: 'ERROR' });
  expect(t.el.textContent).toBe('L:AGENT_GATEWAY.Link.Indicator.reconnecting');
  t.set({ kind: 'disconnected', reason: 'TOKEN_REJECTED' });
  expect(t.el.textContent).toBe('L:AGENT_GATEWAY.Link.Indicator.needsPairing');
  expect(t.root.querySelector).toHaveBeenCalledTimes(1);
  expect(t.row.appendChild).toHaveBeenCalledTimes(1);
});

it('warns once per entry into needsPairing', () => {
  const t = rig();
  t.set({ kind: 'disconnected', reason: 'TOKEN_REJECTED' });
  expect(t.warn).toHaveBeenCalledTimes(1);
  expect(t.warn).toHaveBeenCalledWith('L:AGENT_GATEWAY.Link.Indicator.needsPairingToast');
  t.set({ kind: 'disconnected', reason: 'PAIRING_INVALID' });
  t.set({ kind: 'disconnected', reason: 'TOKEN_REJECTED' });
  expect(t.warn).toHaveBeenCalledTimes(1);
  t.set({ kind: 'connecting' });
  t.set({ kind: 'disconnected', reason: 'TOKEN_REJECTED' });
  expect(t.warn).toHaveBeenCalledTimes(2);
});

it('shows a player nothing until the link is in use, then keeps telling them', () => {
  const t = rig({ isGM: false, stored: false, state: { kind: 'disconnected' } });
  expect(t.el.textContent).toBe('');
  expect(t.el.hidden).toBe(true);
  t.set({ kind: 'connecting' });
  t.set({ kind: 'disconnected', reason: 'TOKEN_REJECTED' });
  expect(t.el.textContent).toBe('L:AGENT_GATEWAY.Link.Indicator.needsPairing');
});

it('a local-only player (no credential, never connected) sees nothing and no toast', () => {
  const t = rig({ isGM: false, stored: false, state: { kind: 'disconnected' } });
  expect(t.el.hidden).toBe(true);
  expect(t.warn).not.toHaveBeenCalled();
});

it('never renders the token, the code or the gateway URL', () => {
  const t = rig({ state: { kind: 'disconnected', reason: 'TOKEN_REJECTED' } });
  const shown = JSON.stringify([t.el.textContent, t.el.attrs, t.el.className]);
  for (const secret of ['secret-token', 'ABCD-EFGH', 'wss://gw.example.com']) {
    expect(shown).not.toContain(secret);
  }
});

it('uses textContent only', () => {
  const src = readFileSync(resolve(__dirname, '../../src/link/status-indicator.ts'), 'utf8');
  expect(src).not.toMatch(/innerHTML|\{\{\{/);
});
