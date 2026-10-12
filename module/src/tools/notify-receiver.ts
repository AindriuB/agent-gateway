/* eslint-disable @typescript-eslint/no-explicit-any */
import { escapeHtml } from './_write.js';
declare const game: any;
declare const ui: any;
const channel = 'module.agent-gateway';
const seen = new Map<string, number>();
let installed: any;
export function displayNotification(message: string, level: 'info' | 'warn' | 'error'): void {
  const marker = game.i18n?.localize?.('AGENT_GATEWAY.Tools.aiMarker');
  if (typeof marker !== 'string' || marker.length > 300)
    throw new Error('Localized AI marker unavailable');
  const method = level === 'warn' ? 'warn' : level;
  if (typeof ui.notifications?.[method] !== 'function')
    throw new Error('Native notifications unavailable');
  ui.notifications[method](escapeHtml(`${marker}: ${message}`));
}
export function receiveNotification(data: any, senderId: unknown): void {
  if (!data || data.kind !== 'agent-gateway.notify') return;
  if (typeof senderId !== 'string' || !game.user || game.users?.get(game.user.id) !== game.user)
    return;
  const sender = game.users.get(senderId);
  if (!sender || sender.isGM !== true || !sender.active) return;
  if (
    Object.keys(data).sort().join(',') !== 'id,kind,level,message,recipients' ||
    typeof data.id !== 'string' ||
    !/^[a-zA-Z0-9-]{1,100}$/.test(data.id) ||
    typeof data.message !== 'string' ||
    !data.message.length ||
    data.message.length > 300 ||
    !['info', 'warn', 'error'].includes(data.level) ||
    !Array.isArray(data.recipients) ||
    !data.recipients.length ||
    data.recipients.length > 20 ||
    new Set(data.recipients).size !== data.recipients.length ||
    data.recipients.some(
      (id: any) =>
        typeof id !== 'string' || !id.length || id.length > 100 || !game.users.get(id)?.active,
    ) ||
    !data.recipients.includes(game.user.id)
  )
    return;
  const now = Date.now();
  for (const [key, time] of seen) if (now - time > 30000) seen.delete(key);
  const key = `${senderId}:${data.id}`;
  if (seen.has(key)) return;
  if (seen.size >= 128) return;
  seen.set(key, now);
  displayNotification(data.message, data.level);
}
export function installNotificationReceiver(): void {
  if (!game.socket || installed === game.socket) return;
  game.socket.on(channel, receiveNotification);
  installed = game.socket;
}
(globalThis as any).Hooks?.once('ready', installNotificationReceiver);
export function relayNotification(data: any, recipients: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Notification relay acknowledgement timed out')),
      5000,
    );
    try {
      game.socket.emit(channel, data, { recipients }, () => {
        clearTimeout(timer);
        resolve();
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}
