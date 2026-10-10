/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes } from 'node:crypto';
import type { OpCall, OpUser } from '../../src/ops/types.js';
import { ApprovalManager } from '../../src/approvals/manager.js';
import type { ApprovalEnv, EnvUser } from '../../src/approvals/types.js';

export interface HubUser {
  id: string;
  name: string;
  isGM: boolean;
  online: boolean;
}

export interface Client {
  user: HubUser;
  manager: ApprovalManager;
  /** Hook calls seen by this client, in order. */
  hooks: Array<{ name: string; payload: any }>;
  /** What this browser's storage holds. */
  storage: { text: string };
  rerun: (call: OpCall, user: OpUser) => Promise<any>;
  setRerun(fn: (call: OpCall, user: OpUser) => Promise<any>): void;
}

/**
 * Several Foundry clients in one process, joined by a fake module socket that behaves like the
 * server: it appends the true sender id as the second argument and delivers only to online users.
 */
export class Hub {
  now = 1_000_000;
  users = new Map<string, HubUser>();
  clients = new Map<string, Client>();
  private timers: Array<{ at: number; fn: () => void; id: number }> = [];
  private nextTimer = 1;
  /** Every message sent: who sent it (server-attested) and to whom. */
  sent: Array<{ sender: string; data: any; to: string[] | undefined }> = [];

  addUser(id: string, isGM: boolean, online = true): HubUser {
    const u = { id, name: id.toUpperCase(), isGM, online };
    this.users.set(id, u);
    return u;
  }

  client(
    id: string,
    opts: { waitMs?: number; storage?: { text: string }; random?: (n: number) => Uint8Array } = {},
  ): Client {
    const user = this.users.get(id)!;
    const hooks: Client['hooks'] = [];
    const storage = opts.storage ?? { text: '' };
    let rerun: Client['rerun'] = async () => ({ error: { code: 'INTERNAL', message: 'no rerun' } });
    const view = (u: HubUser): EnvUser => ({
      id: u.id,
      name: u.name,
      isGM: u.isGM,
      active: u.online,
    });
    const env: ApprovalEnv = {
      localUser: () => view(user),
      user: (uid) => (this.users.has(uid) ? view(this.users.get(uid)!) : undefined),
      users: () => [...this.users.values()].map(view),
      emit: (data, recipients) => this.deliver(id, data, recipients),
      callHook: (name, payload) => hooks.push({ name, payload }),
      load: () => storage.text,
      save: (t) => void (storage.text = t),
      now: () => this.now,
      setTimer: (fn, ms) => {
        const t = { at: this.now + ms, fn, id: this.nextTimer++ };
        this.timers.push(t);
        return t.id;
      },
      clearTimer: (h) => void (this.timers = this.timers.filter((t) => t.id !== h)),
      rerun: (call, u) => rerun(call, u),
      random: opts.random ?? ((n) => new Uint8Array(randomBytes(n))),
      t: (key, data = {}) => `${key}${Object.keys(data).length ? ' ' + JSON.stringify(data) : ''}`,
    };
    const manager = new ApprovalManager(env, { waitMs: opts.waitMs ?? 30_000 });
    const c: Client = {
      user,
      manager,
      hooks,
      storage,
      rerun: (call, u) => rerun(call, u),
      setRerun: (fn) => void (rerun = fn),
    };
    this.clients.set(id, c);
    return c;
  }

  /** Deliver as the server does: the sender id is the real sender, whatever the payload says. */
  deliver(sender: string, data: unknown, recipients?: string[]): void {
    const copy = JSON.parse(JSON.stringify(data));
    this.sent.push({ sender, data: copy, to: recipients });
    for (const [uid, c] of this.clients) {
      if (uid === sender || !this.users.get(uid)!.online) continue;
      if (recipients && !recipients.includes(uid)) continue;
      c.manager.handleSocket(JSON.parse(JSON.stringify(data)), sender);
    }
  }

  /** A user comes online: the `userConnected` hook fires on every other client. */
  connect(id: string): void {
    this.users.get(id)!.online = true;
    for (const [uid, c] of this.clients) if (uid !== id) c.manager.representTo(id);
  }

  /** Move the clock and run due timers, letting promises settle between them. */
  async advance(ms: number): Promise<void> {
    const end = this.now + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.now = Math.max(this.now, due.at);
      due.fn();
      await settle();
    }
    this.now = end;
    await settle();
  }
}

export const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
