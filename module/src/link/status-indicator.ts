import type { LinkState } from './client.js';

/** What the Players list shows about this browser's gateway link. */
export type IndicatorState =
  'connected' | 'reconnecting' | 'awaitingGm' | 'needsPairing' | 'elsewhere' | 'hidden';

/**
 * Map a link state to what the current user sees. `inUse` is false for a non-GM whose link is not
 * in use (no stored credential, no active link); that user sees nothing.
 */
export function indicatorState(state: LinkState, inUse: boolean): IndicatorState {
  if (!inUse) return 'hidden';
  switch (state.kind) {
    case 'connected':
      return 'connected';
    case 'connecting':
      return 'reconnecting';
    case 'awaiting-gm':
      return 'awaitingGm';
    default:
      switch (state.reason) {
        case 'ERROR':
          return 'reconnecting';
        case 'PAIRING_REQUIRED':
        case 'PAIRING_INVALID':
        case 'TOKEN_REJECTED':
          return 'needsPairing';
        case 'REPLACED':
          return 'elsewhere';
        default:
          return 'hidden';
      }
  }
}

/** The few DOM members the indicator uses, so it can be tested without a DOM. */
export interface IndicatorElement {
  textContent: string | null;
  className: string;
  hidden: boolean;
  setAttribute(name: string, value: string): void;
}
export interface IndicatorRow {
  appendChild(el: IndicatorElement): unknown;
}
export interface IndicatorRoot {
  querySelector(selector: string): IndicatorRow | null;
}

export interface IndicatorDeps {
  client: {
    readonly state: LinkState;
    onState(fn: (s: LinkState) => void): () => void;
    hasStoredToken?(): boolean;
  };
  isGM(): boolean;
  userId(): string | undefined;
  localize(key: string): string;
  warn(message: string): void;
  createElement(): IndicatorElement;
}

export const INDICATOR_CLASS = 'agent-gateway-indicator';

export interface StatusIndicator {
  /** Put the element on the current user's row of a freshly rendered Players list. */
  render(root: IndicatorRoot | null | undefined): void;
  dispose(): void;
}

export function createStatusIndicator(deps: IndicatorDeps): StatusIndicator {
  let el: IndicatorElement | null = null;
  let current: IndicatorState = 'hidden';
  // A player's link counts as in use once it has held a credential or been active; a rejected
  // token is cleared, but the user still needs to hear that pairing is needed.
  let used = false;

  const apply = (state: LinkState, notify: boolean): void => {
    if (deps.client.hasStoredToken?.() || state.kind !== 'disconnected') used = true;
    const next = indicatorState(state, deps.isGM() || used);
    if (notify && next === 'needsPairing' && current !== 'needsPairing')
      deps.warn(deps.localize('AGENT_GATEWAY.Link.Indicator.needsPairingToast'));
    current = next;
    if (!el) return;
    el.hidden = next === 'hidden';
    el.setAttribute('data-state', next);
    el.textContent = next === 'hidden' ? '' : deps.localize(`AGENT_GATEWAY.Link.Indicator.${next}`);
  };

  const unsubscribe = deps.client.onState((s) => apply(s, true));
  apply(deps.client.state, true);

  return {
    render(root) {
      const id = deps.userId();
      if (!root || !id) return;
      const row = root.querySelector(`[data-user-id="${id.replace(/["\\\]]/g, '')}"]`);
      if (!row) return;
      el = deps.createElement();
      el.className = INDICATOR_CLASS;
      row.appendChild(el);
      apply(deps.client.state, false);
    },
    dispose() {
      unsubscribe();
      el = null;
    },
  };
}

declare const Hooks: { on(hook: string, fn: (app: unknown, html: unknown) => void): void };
declare const game: {
  user?: { id?: string; isGM?: boolean };
  i18n: { localize(k: string): string };
};
declare const ui: {
  notifications?: { warn(m: string): void };
  players?: { render?(force?: boolean): unknown };
};

/** Wire the indicator to Foundry: the Players list hook, the user, and the document. */
export function installStatusIndicator(client: IndicatorDeps['client']): StatusIndicator {
  const indicator = createStatusIndicator({
    client,
    isGM: () => game.user?.isGM === true,
    userId: () => game.user?.id,
    localize: (k) => game.i18n.localize(k),
    warn: (m) => {
      if (typeof ui !== 'undefined') ui.notifications?.warn(m);
    },
    createElement: () => document.createElement('span') as unknown as IndicatorElement,
  });
  Hooks.on('renderPlayers', (_app, html) => {
    // Foundry 12 passes a jQuery object, 13 an element.
    const has = (x: unknown): x is IndicatorRoot =>
      typeof (x as IndicatorRoot | undefined)?.querySelector === 'function';
    const first = (html as { 0?: unknown } | undefined)?.[0];
    const root = has(html) ? html : has(first) ? first : undefined;
    indicator.render(root);
  });
  // The Players list was drawn before this hook existed.
  if (typeof ui !== 'undefined') ui.players?.render?.();
  return indicator;
}
