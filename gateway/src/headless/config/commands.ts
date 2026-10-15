import { dirname } from 'node:path';
import { ConfigError, agentPasswordEnv, normalizeFoundryUrl } from '../../config/index.js';
import { safeText } from '../../routing/sanitize.js';
import { openStore } from '../../store/index.js';
import { profileDir } from '../profile.js';
import { AGENT_NAME } from './repository.js';

export const HEADLESS_USAGE = `  headless add <name> --foundry-url <url> --world <id> --user <id> [--owner <id>]
                      Store a headless agent (a Foundry user the gateway logs in with its own
                      Chromium) and exit. <name> is 1 to 32 characters of a-z, 0-9 and -. The
                      password is never stored: set AGENT_GATEWAY_HEADLESS_<NAME>_PASSWORD
                      (name in capitals, - as _) or headless.<name>.password in the 0600
                      --config file, for the gateway that runs it. --owner is the Foundry user
                      id whose approvals this agent's actions go to. Existing pairings and OAuth grants
                      for that world and user are revoked and its unused invites cancelled, so a
                      browser already using it must pair again. A
                      running gateway starts the agent within seconds if it already holds the password
  headless list       List stored agents (name, world, user, owner, Foundry URL), no passwords
  headless remove <name>
                      Delete the agent, revoke its pairings and OAuth grants, and exit; a running
                      gateway stops its browser within seconds. The browser profile is kept
`;

export interface HeadlessCommandInput {
  argv: readonly string[];
  values: {
    'foundry-url'?: string | undefined;
    world?: string | undefined;
    user?: string | undefined;
    owner?: string | undefined;
    password?: string | undefined;
  };
  dbPath: string;
  /** The read-only schema check the other operator commands use; never migrates. */
  schemaProblem(path: string): string | undefined;
  /** The flag/env agent of this invocation, so `add` can refuse to duplicate it. */
  flagAgent(): { worldId: string; userId: string } | undefined;
  out(line: string): void;
  err(line: string): void;
}

const MAX_ID = 64;

/** Run `headless add|list|remove`. Returns the process exit code: 0 done, 1 failed, 2 usage. */
export function runHeadlessCommand(input: HeadlessCommandInput): number {
  const [action, ...rest] = input.argv;
  const usage = (why: string): number => {
    input.err(`${why}\n${HEADLESS_USAGE}`);
    return 2;
  };
  if (action !== 'add' && action !== 'list' && action !== 'remove')
    return usage('headless needs add, list or remove');
  const { values } = input;
  // No flag can carry a password: it would sit in the process list and shell history.
  if (values.password !== undefined)
    return usage(
      'There is no password flag. Set AGENT_GATEWAY_HEADLESS_<NAME>_PASSWORD or headless.<name>.password in the 0600 --config file',
    );
  if (input.dbPath === ':memory:') return usage(`headless ${action} needs a database file`);
  const flag = `headless ${action}`;
  let name = '';
  if (action === 'list') {
    if (rest.length > 0) return usage('headless list takes no arguments');
  } else {
    if (rest.length !== 1) return usage(`headless ${action} needs exactly one <name>`);
    name = rest[0]!;
    if (!AGENT_NAME.test(name))
      return usage(
        'The agent name must match ^[a-z0-9][a-z0-9-]{0,31}$ (lowercase letters, digits, -)',
      );
  }
  let foundryUrl = '';
  let owner: string | undefined;
  if (action === 'add') {
    const { world, user } = values;
    if (!world || !user || !values['foundry-url'])
      return usage('headless add needs --foundry-url, --world and --user');
    if (world.length > MAX_ID || user.length > MAX_ID)
      return usage(`--world and --user are 1 to ${MAX_ID} characters`);
    owner = values.owner;
    if (owner !== undefined && (owner === '' || owner.length > MAX_ID))
      return usage(`--owner is 1 to ${MAX_ID} characters`);
    try {
      foundryUrl = normalizeFoundryUrl(values['foundry-url']);
    } catch (err) {
      if (!(err instanceof ConfigError)) throw err;
      // The URL may carry a secret: only the reason is shown, never the value.
      const why = err.message.split('): ').slice(1).join('): ');
      return usage(`Invalid --foundry-url (value not shown, it may carry a secret): ${why}`);
    }
    const fa = input.flagAgent();
    if (fa && fa.worldId === world && fa.userId === user)
      return usage(
        'That world and user are already the headless agent set by --headless-* flags or AGENT_GATEWAY_HEADLESS_* variables',
      );
  }
  const problem = input.schemaProblem(input.dbPath);
  if (problem) {
    input.err(`${flag} failed: ${problem}${action === 'list' ? '' : '; nothing changed'}\n`);
    return 1;
  }
  const store = openStore(input.dbPath);
  try {
    switch (action) {
      case 'list': {
        for (const a of store.headless.list())
          input.out(
            `${a.name}  ${safeText(a.worldId)}  ${safeText(a.userId)}  owner ${a.ownerUserId ? safeText(a.ownerUserId) : '-'}  ${safeText(a.foundryUrl)}\n`,
          );
        return 0;
      }
      case 'add': {
        const world = values.world!;
        const user = values.user!;
        let revoked: { pairings: unknown[]; cancelledInvites: number } | undefined;
        const refusal = store.transaction(() => {
          if (store.headless.get(name)) return `An agent named ${name} already exists`;
          const same = store.headless.getByIdentity(world, user);
          if (same) return `Agent ${same.name} already uses that world and user`;
          store.headless.add({
            name,
            foundryUrl,
            worldId: world,
            userId: user,
            ownerUserId: owner ?? null,
          });
          // The identity becomes a headless agent: browsers already connected or paired as it
          // hold a stale classification, so revoke them; they re-pair and are classified afresh.
          revoked = store.revokePairingsFor(world, user);
          return undefined;
        });
        if (refusal) {
          input.err(`${refusal}; nothing changed\n`);
          return 1;
        }
        input.out(
          `Added headless agent ${name} (world ${safeText(world)}, user ${safeText(user)}).\n` +
            `Revoked ${revoked?.pairings.length ?? 0} pairing(s) and that world and user's OAuth grants and cancelled ${revoked?.cancelledInvites ?? 0} unused invite(s); a browser using it must pair again.\n` +
            `Its password is not stored. Set ${agentPasswordEnv(name)} or headless.${name}.password in the 0600 --config file for the gateway that runs it (the agent user needs a Foundry password).\n` +
            'A running gateway starts it within seconds if it already holds the password; otherwise restart that gateway.\n',
        );
        return 0;
      }
      case 'remove': {
        const out = store.transaction(() => {
          const row = store.headless.get(name);
          if (!row) return undefined;
          store.headless.remove(name);
          return { row, revoked: store.revokePairingsFor(row.worldId, row.userId) };
        });
        if (!out) {
          input.err(`No headless agent named ${name}; nothing changed\n`);
          return 1;
        }
        const dir = profileDir(dirname(input.dbPath), out.row.worldId, out.row.userId);
        input.out(
          `Removed headless agent ${name}; revoked ${out.revoked.pairings.length} pairing(s) and that world and user's OAuth grants and cancelled ${out.revoked.cancelledInvites} unused invite(s). A running gateway stops its browser within seconds.\n` +
            `The browser profile was kept at ${dir}; it can be deleted once the gateway has restarted.\n`,
        );
        return 0;
      }
    }
  } catch (err) {
    const msg = (err as Error).message;
    input.err(
      `${flag} failed (${/locked|busy/i.test(msg) ? 'the database is busy' : safeText(msg)})${action === 'list' ? '' : '; nothing changed'}\n`,
    );
    return 1;
  } finally {
    store.close();
  }
}
