/* eslint-disable @typescript-eslint/no-explicit-any */
import { parsePairingInput } from '../link/invite-string.js';
import { isStrictGatewayUrl, resolveGateway } from '../link/gateway-url.js';
import { redeemInvite } from '../apps/pairing/index.js';
declare const game: any;
declare const ui: any;
declare const Hooks: any;

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

const WORLD_KEY = `${NS}.defaultGatewayUrl`;

/** What may be stored in the world default: the address only, or '' when nothing usable remains. */
function cleanWorld(raw: string): { value: string; warn?: string } {
  if (raw === '' || isStrictGatewayUrl(raw)) return { value: raw };
  const parsed = raw.includes('#') ? parsePairingInput(raw) : undefined;
  if (parsed?.kind === 'invite') {
    return { value: parsed.url, warn: 'AGENT_GATEWAY.Settings.defaultGatewayUrl.codeDropped' };
  }
  return { value: '', warn: 'AGENT_GATEWAY.Settings.defaultGatewayUrl.invalid' };
}

/**
 * Runs on the writing client before the write leaves the browser. `payload.value` is the
 * JSON-encoded string Foundry built, so it is parsed, cleaned and encoded again.
 */
export function preWriteWorldGatewayUrl(
  keyOf: string | undefined,
  payload: { value?: unknown } | undefined,
  userId?: string,
): void {
  if (keyOf !== WORLD_KEY || !payload || typeof payload.value !== 'string') return;
  if (userId !== game.user?.id) return;
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload.value);
  } catch {
    decoded = undefined;
  }
  const raw = typeof decoded === 'string' ? decoded.trim() : '';
  const { value, warn } = cleanWorld(raw);
  payload.value = JSON.stringify(value);
  if (warn) notify('warn', warn);
}

export function registerWorldGatewayUrlHooks(): void {
  if (typeof Hooks === 'undefined') return;
  Hooks.on('preUpdateSetting', (doc: any, changes: any, _o: unknown, userId?: string) =>
    preWriteWorldGatewayUrl(doc?.key ?? changes?.key, changes, userId),
  );
  Hooks.on('preCreateSetting', (doc: any, data: any, _o: unknown, userId?: string) =>
    preWriteWorldGatewayUrl(data?.key ?? doc?.key, data, userId),
  );
}

/**
 * Backstop after the write (for example a value set by a module that skipped the hooks). Only the
 * client that wrote the value acts, and only if it is a GM.
 */
export async function onWorldGatewayUrlChange(
  value?: unknown,
  _options?: unknown,
  userId?: string,
): Promise<void> {
  if (!game.user?.isGM) return;
  if (userId !== undefined && userId !== game.user.id) return;
  const raw = typeof value === 'string' ? value.trim() : '';
  const { value: clean, warn } = cleanWorld(raw);
  if (!warn) return;
  await game.settings.set(NS, 'defaultGatewayUrl', clean);
  notify('warn', warn);
}
