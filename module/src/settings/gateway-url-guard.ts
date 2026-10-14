/* eslint-disable @typescript-eslint/no-explicit-any */
import { parsePairingInput } from '../link/invite-string.js';
import { isStrictGatewayUrl, resolveGateway } from '../link/gateway-url.js';
import { redeemInvite } from '../apps/pairing/index.js';
declare const game: any;
declare const ui: any;

const NS = 'agent-gateway';

function notify(level: 'warn', key: string): void {
  ui.notifications[level](game.i18n.localize(key));
}

/** Configure Settings must not bypass the parser: an invite pasted there is redeemed or stripped. */
export async function onClientGatewayUrlChange(value?: unknown): Promise<void> {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw === '') return;
  if (raw.includes('#')) {
    const parsed = parsePairingInput(raw);
    if (parsed.kind === 'invite') {
      await redeemInvite(parsed);
      return;
    }
    await game.settings.set(NS, 'gatewayUrl', '');
    notify('warn', 'AGENT_GATEWAY.Settings.gatewayUrlOverride.invalid');
    return;
  }
  if (resolveGateway(raw, '').clientInvalid) {
    await game.settings.set(NS, 'gatewayUrl', '');
    notify('warn', 'AGENT_GATEWAY.Settings.gatewayUrlOverride.invalid');
  }
}

/** The world default reaches every client, so a code is never kept and nothing is redeemed. */
export async function onWorldGatewayUrlChange(value?: unknown): Promise<void> {
  if (!game.user?.isGM) return;
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw === '' || isStrictGatewayUrl(raw)) return;
  const parsed = raw.includes('#') ? parsePairingInput(raw) : undefined;
  if (parsed?.kind === 'invite') {
    await game.settings.set(NS, 'defaultGatewayUrl', parsed.url);
    notify('warn', 'AGENT_GATEWAY.Settings.defaultGatewayUrl.codeDropped');
    return;
  }
  await game.settings.set(NS, 'defaultGatewayUrl', '');
  notify('warn', 'AGENT_GATEWAY.Settings.defaultGatewayUrl.invalid');
}
