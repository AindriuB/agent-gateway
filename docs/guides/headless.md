# Run a headless agent

A headless agent is a Foundry user that the gateway logs in itself, in its own Chromium, so the agent works without anyone keeping a browser tab open. The gateway starts the browser, opens your world as that user and pairs the module.

Use it when the agent should be available without a person at a browser, for example a world with no GM online. Read [section 3](#3-reach-the-agent-from-your-ai-client) before you plan on a server-mode gateway, Docker or a remote client: the table there lists what was run, and with a server-mode gateway that has a public URL (as the Compose stack sets it), the stdio clients run did not reach the agent; a remote OAuth client run against it did, through the agent's owner. The agent acts with that user's Foundry permissions and the same policy, approvals and audit as any other agent.

Headless agents need the npm or Docker install. The `.mcpb` bundle does not support them (see [below](#the-mcpb-bundle)).

## 1. Make a dedicated agent user in Foundry

1. In Foundry, create a user for the agent, for example "Assistant". Do not reuse a person's account.
2. **Give the user a password.** This is required. The gateway logs in to Foundry with it, and refuses an empty password. A Foundry user with no password can be logged into by anyone who reaches the world's `/join` page, so the gateway will not run one.
3. Find the user's id and the world's id. The module's pairing app has a "Copy my ids" line that shows both when you are logged in as that user. The world id is also the name of the world's folder under Foundry's `Data/worlds/`.
4. In the world, a GM turns on the policy switches, or the agent's tool calls are refused. As a GM, open Configure Settings, then Agent Gateway, and press "Configure policies" (the "Agent policies" window). Under "Agent access", tick both **Enable player agents** and **Enable headless agents**, then press "Save policies". Both are off until a GM turns them on, and only a GM sees them.
   - A headless agent that is a player (not a GM) needs both. "Enable player agents" covers every agent acting as a non-GM user, and the module checks it first, so with only "Enable headless agents" on, the agent is told "Player agents are turned off in this world. A GM must turn on "Enable player agents" in the Agent Gateway settings."
   - If the agent's Foundry user is a GM, "Enable player agents" is not needed, but "Enable headless agents" still is. While it is off the agent is told "Headless agents are turned off in this world. A GM must turn on "Enable headless agents" in the Agent Gateway settings."
   - The same window sets what the agent may do. A non-GM agent follows the "Player agents" rows of the policy matrix, so some of its calls may wait for approval from its owner or a GM.
5. Optionally pick an owner: the id of the Foundry user whose approval prompts this agent's asks go to (`--owner`, below). The owner is a routing hint for approvals. It grants no permission. Without one, approvals follow the world policy as usual.

The agent user is not for humans. Its pairing comes only from invites the gateway mints for it, and adding it as a headless agent revokes any pairing that browser already had.

## 2. Tell the gateway about it

There are two ways. Both need the Foundry URL, the world id, the user id and the password.

### One agent, from flags or environment

All four settings together, or none:

```
AGENT_GATEWAY_HEADLESS_PASSWORD='the agent user password' \
node <repo>/gateway/dist/bin/cli.js \
  --headless-foundry-url http://localhost:30000 \
  --headless-world my-world \
  --headless-user AbCdEf1234567890
```

`--headless-user` is a Foundry user id, not a name. There is no password flag, because flags show up in process listings. Give the password in the environment as `AGENT_GATEWAY_HEADLESS_PASSWORD`, or put `headlessPassword` in a config file that only you can read:

```
{
  "headlessFoundryUrl": "http://localhost:30000",
  "headlessWorld": "my-world",
  "headlessUser": "AbCdEf1234567890",
  "headlessPassword": "the agent user password"
}
```

```
chmod 600 gateway.json
node <repo>/gateway/dist/bin/cli.js --config gateway.json
```

The settings can also be given as `AGENT_GATEWAY_HEADLESS_FOUNDRY_URL`, `AGENT_GATEWAY_HEADLESS_WORLD` and `AGENT_GATEWAY_HEADLESS_USER`.

### Several agents, stored in the gateway

`headless add` stores an agent in the gateway's database, so you can have more than one and change them without editing flags:

```
node <repo>/gateway/dist/bin/cli.js headless add scribe \
  --foundry-url http://localhost:30000 --world my-world --user AbCdEf1234567890 \
  --owner GmUserId0000001
node <repo>/gateway/dist/bin/cli.js headless list
node <repo>/gateway/dist/bin/cli.js headless remove scribe
```

The name is 1 to 32 characters of `a-z`, `0-9` and `-`. `--owner` is optional. The gateway must have run once so that the database exists.

The password is never stored in the database. A stored agent finds its password in one of two places, for the gateway that runs it:

- the environment variable `AGENT_GATEWAY_HEADLESS_<NAME>_PASSWORD`, where the name is in capitals and `-` becomes `_` (so `scribe` is `AGENT_GATEWAY_HEADLESS_SCRIBE_PASSWORD` and `night-shift` is `AGENT_GATEWAY_HEADLESS_NIGHT_SHIFT_PASSWORD`);
- or `headless.<name>.password` in the 0600 config file:

  ```
  { "headless": { "scribe": { "password": "the agent user password" } } }
  ```

An agent with no password available is not started. The gateway logs, once (`scribe` is the agent's name):

```
headless agent scribe has no password in this gateway's environment or config file; not started
```

Passwords are read once when the gateway starts. A new or changed password needs a restart.

What `add` and `remove` do to existing access:

- `add` revokes the existing pairings and OAuth grants for that world and user, and cancels their unused invites. A browser that was using that user has to pair again. This is deliberate: the agent user is not for humans.
- `remove` deletes the agent and revokes the same things, and keeps the browser profile on disk. It prints the profile's path, for example `/home/you/.foundry-agent-gateway/headless/profiles/my-world-abcdef1234567890-ebba4b5a6926`, so you can delete it by hand once the gateway has restarted.
- A running gateway notices an `add` or `remove` within about 5 seconds. It starts a new stored agent at once only if it already holds that agent's password; otherwise restart it.

**Caution.** `add` checks for a duplicate of the flag/env agent only as its own invocation sees it. If you run `headless add` from a shell that does not have the running gateway's `--headless-*` flags, environment or config file, it will accept the same world and user and revoke that agent's pairing. The running gateway keeps its flag/env agent and pairs it again with a fresh invite, so the agent drops for a moment. Run `add` with the same environment and config the gateway has.

## 3. Reach the agent from your AI client

A headless agent is never picked by follow mode. A session started without `--user` binds to a person's browser pairing, never to a headless identity. To use the agent, bind to it explicitly with its world and user id. In local mode (the npm or from-source install, not server mode), start the gateway that runs the agent with `--world` and `--user` next to the `--headless-*` settings, so one command both runs the agent and binds the session to it:

```
claude mcp add foundry-agent -e AGENT_GATEWAY_HEADLESS_PASSWORD='the agent user password' -- \
  node <repo>/gateway/dist/bin/cli.js \
  --headless-foundry-url http://localhost:30000 --headless-world my-world --headless-user AbCdEf1234567890 \
  --world my-world --user AbCdEf1234567890
```

The `-e` flag puts the variable into the environment of the gateway the client starts. The value is then stored in the client's own config file, so protect that file like the gateway's 0600 config file. (This `claude mcp add` form was not run when this guide was written; the Claude Code CLI was not installed. Check it against `claude mcp add --help`.) Putting `AGENT_GATEWAY_HEADLESS_PASSWORD=...` in front of `claude mcp add` does not work: it sets the variable only for that one command, not for the gateway the client starts later. For other clients, set the variable however that client passes environment variables to an MCP server, export it in the shell that starts the client, or put `headlessPassword` in the 0600 config file. There is no password flag.

Which combinations reach a headless agent today. Every row was run against Foundry v14 (14.369, pf2e 8.6.0) except the `docker compose exec -T` form, which was not run. The remote OAuth row used a scripted OAuth client (discovery, dynamic registration, PKCE S256); the claude.ai, ChatGPT and Gemini connectors themselves were not run. In the runs that reached the agent, the gateway logged it in with its own Chromium and logged `link connected`.

| Gateway                              | Client                                                                                                                                                                                       | Reaches the agent? | What happens                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local mode                           | stdio, started with the `--headless-*` settings and `--world`/`--user`                                                                                                                       | **Yes**            | The session reads as the agent (`world_info` and `gateway_status` were called).                                                                                                                                                                                                                                                                                                                  |
| Local mode                           | A second stdio session started with only `--world` and `--user` (same `--link-port`; a different `--http-port` from the first row)                                                           | **Yes**            | It relays to the first gateway, which holds the link port and the agent. Its session settings and its `--world`/`--user` must match the first gateway's.                                                                                                                                                                                                                                         |
| Local mode, `--http`                 | HTTP with the static bearer token, the gateway started with `--world` and `--user`                                                                                                           | **Yes**            | The HTTP session is bound to the agent.                                                                                                                                                                                                                                                                                                                                                          |
| Local mode, `--http`                 | HTTP with the static bearer token, the gateway started without `--world`/`--user`                                                                                                            | No                 | No person was paired, and follow mode never picks a headless identity, so the session answered `WORLD_OFFLINE: Not connected to Foundry yet. ...`, even though the agent was connected.                                                                                                                                                                                                          |
| Server mode with a public URL        | stdio, same settings as the primary (`--server-mode`, same `--public-url`)                                                                                                                   | No                 | A server-mode gateway does not relay. The new process exits with `link port 7527 is in use; is another gateway running?` (the port is whatever `--link-port` you gave).                                                                                                                                                                                                                          |
| Server mode with a public URL        | stdio without `--server-mode`                                                                                                                                                                | No                 | It goes to standby: `the primary gateway has different session settings (server mode off here vs on there) and is kept because it runs a headless agent`.                                                                                                                                                                                                                                        |
| Server mode with a public URL        | stdio with `--world`/`--user` against a server-mode primary started without them                                                                                                             | No                 | `the primary gateway refused this instance: selector mismatch`, followed by the two selectors, the primary's being `world=(any) user=(any)`.                                                                                                                                                                                                                                                     |
| Server mode, no public URL           | HTTP with the static bearer token, the gateway started with `--server-mode`, the `--headless-*` settings and `--world`/`--user`, and no `--public-url`                                       | **Yes**            | The server-mode gateway keeps the static bearer. `world_info` and `gateway_status` answered as the agent.                                                                                                                                                                                                                                                                                        |
| Server mode in Docker, no public URL | HTTP with the static bearer token printed in the container's log; the image run with `--network host`, the `--headless-*` settings and `--world`/`--user`, and no `AGENT_GATEWAY_PUBLIC_URL` | **Yes**            | The container log shows `link connected: world test-world / user Agent`. `world_info` and `gateway_status` answered as the agent.                                                                                                                                                                                                                                                                |
| Server mode in Docker, no public URL | `docker exec -i <container> foundry-agent-gateway --world ... --user ...` (the `docker compose exec -T` form was not run)                                                                    | No                 | In the run the container already had the agent's password in its environment, so the new process exited with `The headless agent needs --headless-foundry-url, --headless-world, --headless-user and AGENT_GATEWAY_HEADLESS_PASSWORD ... together`. An earlier run against a container started without the agent's password exited with `link port 7420 is in use; is another gateway running?`. |
| Server mode                          | Remote OAuth clients (claude.ai, ChatGPT, Gemini)                                                                                                                                            | **Yes**            | Run with a scripted OAuth client, not the real connectors. Needs a stored agent added with `--owner` and the owner online in Foundry; the code goes to the owner's Foundry window. `world_info` answered as the agent user. See below.                                                                                                                                                           |

Server mode with a public URL (`--public-url`, which the Compose stack sets with `AGENT_GATEWAY_PUBLIC_URL`) starts the headless agent, logs it in and pairs it (`link connected: world my-world / user ...`). The stdio clients run against it did not reach the agent; a remote OAuth client did, through the agent's owner (below). Without a public URL, server mode keeps the static bearer, and an HTTP client with it reached the agent, both from source and in the Docker image. Remote OAuth is covered below. Anything not in the table has not been tried.

**Remote OAuth clients (claude.ai, ChatGPT, Gemini) reach a headless agent through its owner.** The agent must be a stored agent added with `headless add ... --owner <foundry-user-id>`; the flag/env agent has no owner and is not supported. When the consent page names the agent, the code is shown in the owner's Foundry window ("... as headless agent <name>"), not the agent's, so the owner must be connected to Foundry to receive it; the owner types it on the page to approve. The page looks the same for every name, so if no code arrives it gives no hint why (no owner, owner offline, or the agent has not paired). The grant is bound to the agent, and the owner gains no permission of their own. A grant ends when the agent re-pairs, which `headless add`, `headless remove` and redeeming a new invite for that user all cause; the owner then approves again. A gateway restart does not end a grant: the runner reconnects with its stored token (no new invite) and an existing OAuth token kept working in the run.

## The browser

The gateway looks for a browser in this order: system Chrome, then Edge, then Chromium, then a Chromium it finds under `<state dir>/browsers/` (the state dir is the folder holding `gateway.db`, `~/.foundry-agent-gateway` by default). When the first headless runner starts, the gateway looks and logs one of:

```
headless runner browser: chromium at /usr/bin/chromium
```

```
headless agents: no Chrome, Edge or Chromium found; install one, or put Chromium under /home/you/.foundry-agent-gateway/browsers. Runners off
```

The Docker image ships Debian's Chromium at `/usr/bin/chromium`, so it needs nothing more. Profiles, one per world and user, are under `<state dir>/headless/profiles/` with mode 0700. They hold a logged-in Foundry session and the module's pairing token.

## The sandbox

Chromium runs sandboxed by default, which is the safe setting. This is the case for the npm and from-source installs.

On Ubuntu 23.10 and later, `kernel.apparmor_restrict_unprivileged_userns=1` stops an ordinary Chrome or Chromium from creating the user namespace its sandbox needs, and it fails with "No usable sandbox!". The runner then logs, once:

```
headless runner: Chromium could not start with its sandbox (often Ubuntu AppArmor restricting unprivileged user namespaces, or a container); set AGENT_GATEWAY_HEADLESS_NO_SANDBOX=1 to run it unsandboxed
```

There are two fixes.

1. **Run it unsandboxed.** Set `AGENT_GATEWAY_HEADLESS_NO_SANDBOX=1` (or `"headlessNoSandbox": true` in the config file). The trade-off: a flaw in a web page the agent loads, which is your own Foundry, could then take over the browser process with your user's rights on the machine. For a Chromium that loads only your own Foundry this is a modest risk, but it is a real step down.
2. **Allow that Chromium through AppArmor** and keep the sandbox. Ubuntu's documented method is a profile that grants the `userns` permission to that one binary, for example in `/etc/apparmor.d/chromium-agent-gateway`:

   ```
   abi <abi/4.0>,
   include <tunables/global>
   profile chromium-agent-gateway /path/to/chrome flags=(unconfined) {
     userns,
     include if exists <local/chromium-agent-gateway>
   }
   ```

   then `sudo apparmor_parser -r /etc/apparmor.d/chromium-agent-gateway`. This profile is Ubuntu's published pattern and was not run for this guide.

**Docker.** The image sets `AGENT_GATEWAY_HEADLESS_NO_SANDBOX=1`, because Chromium's sandbox cannot normally start as a non-root user in a container without extra capabilities or a custom seccomp profile. The container itself is the boundary. If you run the container with those capabilities or a seccomp profile that allows user namespaces, set the variable back to `0` in your override file to turn the sandbox on.

## Certificates and addresses

- **The Foundry URL needs a certificate that both Node and Chromium trust.** The runner reads `<foundry url>/api/status` from Node and then drives Chromium at the same URL. Use a public certificate, or plain `http` on loopback (`http://localhost:30000`). A private certificate authority, such as Caddy's `tls internal`, is trusted by neither, so a host like `foundry.local` behind it fails.
- **The link must stay reachable at `ws://localhost:<port>`.** The runner's page connects to the gateway's link there. A `--link-host` bound to a single non-loopback address cuts the runner off. Keep the link on loopback (the default), or on an address that includes loopback.

## The .mcpb bundle

Headless agents are not supported in the `.mcpb` bundle, because `playwright-core` is not bundled. If you configure one anyway the runner logs, once, with its `headless runner: ` prefix:

```
headless runner: playwright-core is not installed; the headless runner needs the npm or Docker install, not the .mcpb bundle
```

Use the npm or Docker install.

## In Docker

The image runs in server mode. A headless agent in it starts and pairs; in the runs, an HTTP client with the static bearer reached it when no `AGENT_GATEWAY_PUBLIC_URL` was set, and `docker exec -i` did not (see the table in [section 3](#3-reach-the-agent-from-your-ai-client)). The Compose stack sets a public URL, which was not run with a headless agent.

The Compose files are not edited. Add the headless settings with an override file next to `compose.yaml`. This is `compose.headless.yaml`:

```
services:
  gateway:
    environment:
      AGENT_GATEWAY_HEADLESS_FOUNDRY_URL: https://foundry.example.com
      AGENT_GATEWAY_HEADLESS_WORLD: my-world
      AGENT_GATEWAY_HEADLESS_USER: AbCdEf1234567890
      AGENT_GATEWAY_HEADLESS_PASSWORD: ${AGENT_GATEWAY_HEADLESS_PASSWORD:?set it in .env}
```

Put `AGENT_GATEWAY_HEADLESS_PASSWORD=...` and `COMPOSE_FILE=compose.yaml:compose.headless.yaml` in `.env`, and make `.env` readable by you only (`chmod 600 .env`). Then `docker compose up -d`. For stored agents, pass `AGENT_GATEWAY_HEADLESS_<NAME>_PASSWORD` the same way and add the agent against the container's own database:

```
docker compose exec gateway foundry-agent-gateway headless add scribe \
  --foundry-url https://foundry.example.com --world my-world --user AbCdEf1234567890
docker compose exec gateway foundry-agent-gateway headless list
docker compose exec gateway foundry-agent-gateway headless remove scribe
```

The database is `/data/gateway.db` in the `gateway-data` volume, and profiles are under `/data/headless/profiles/`. The Foundry URL is read from inside the container, so `localhost` there is the container, not your host. Use the public address of your Foundry, with a public certificate.

## Stopping

SIGHUP, SIGINT and SIGTERM all stop the gateway gracefully and close the headless browser within 5 seconds (`docker compose stop` sends SIGTERM).

## Several gateways on one link port

Only one gateway process holds the link port; the others relay to it or wait. When a newer gateway starts, the old rules decide who keeps the port, with these rules for headless settings.

- The headless settings take part in that comparison as a one-way digest of the Foundry URL, world, user, the sandbox setting and the stored-agent passwords this process holds. No password and no URL credentials are sent.
- A gateway that runs a headless agent is never displaced by a caller without headless settings. If the session settings (`publicUrl`, `serverMode`, `allowOrigins`) match, the caller relays to it. If they do not, the caller goes to standby with the reason:

  ```
  the primary gateway has different session settings (...) and is kept because it runs a headless agent
  ```

  (the brackets name the differing settings).

- A caller that has headless settings follows the normal rules: if it is newer and different, it takes over; if it is older and different, it goes to standby.
- A primary from before headless support ignores headless settings. A headless caller then goes to standby with the reason:

  ```
  primary too old, headless agent not running: the gateway holding the link port does not understand headless settings; upgrade or stop it
  ```

  and takes over by itself when that old primary exits.

- So run the same version on every gateway that shares a link port.

## Commands run for this guide

`headless add`, `list` and `remove`, the missing-password and no-browser log lines, and the Docker commands were run against a locally built image on Debian's Chromium. Every row of the table in section 3 was run except the `docker compose exec -T` form: a local-mode gateway with a stdio client, a second relaying stdio session, and an HTTP client with the static bearer (with and without `--world`/`--user`); a server-mode gateway with `--public-url` and three kinds of stdio client; a server-mode gateway without a public URL with an HTTP client and the static bearer; the Docker image without a public URL with an HTTP client and the static bearer; the container with `docker exec -i`; and a server-mode gateway with `--public-url` and a scripted OAuth client for a stored agent with an owner, including a gateway restart. The claude.ai, ChatGPT and Gemini connectors were not run. The AppArmor profile and the AppArmor failure were not reproduced for this guide. The runner log line for a missing Foundry server, `headless runner: cannot read http://localhost:30000/api/status: fetch failed (ECONNREFUSED)`, is what you see when the Foundry URL is wrong or Foundry is down.
