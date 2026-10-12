/* eslint-disable @typescript-eslint/no-explicit-any */
import { notify } from '@agent-gateway/protocol';
import { defineWriteHandler, invalid } from './_write.js';
import { gm, collection } from './_scene.js';
import {
  displayNotification,
  relayNotification,
  installNotificationReceiver,
} from './notify-receiver.js';
declare const game: any;
export const notifyHandler = defineWriteHandler({
  targets: () => [],
  async run(ctx) {
    const args = notify.input.parse(ctx.args);
    const user = gm(ctx);
    const all = collection(game.users);
    const ids = args.users ?? all.filter((u) => u.active).map((u) => u.id);
    if (!ids.length || ids.length > 20 || new Set(ids).size !== ids.length)
      invalid('Select at most 20 unique active users');
    const users = ids.map((id) => game.users.get(id));
    const validate = () => {
      if (gm(ctx) !== user || users.some((u, i) => !u || game.users.get(ids[i]) !== u || !u.active))
        invalid('Notification recipient or GM identity changed');
    };
    validate();
    const remote = ids.filter((id) => id !== user.id);
    installNotificationReceiver();
    if (remote.length) {
      if (typeof game.socket?.emit !== 'function')
        invalid('Native notification transport unavailable');
      await relayNotification(
        {
          kind: 'agent-gateway.notify',
          id: crypto.randomUUID(),
          message: args.message,
          level: args.level,
          recipients: ids,
        },
        remote,
      );
      validate();
    }
    const local = ids.includes(user.id);
    if (local) displayNotification(args.message, args.level);
    return {
      text: 'Notification relay accepted; recipient display is not acknowledged',
      structured: { users: ids, relayed: remote.length > 0, local },
    };
  },
});
