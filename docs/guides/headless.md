# Run a headless agent

A headless agent is a Foundry user that the gateway logs in itself, in its own Chromium, so the agent works without anyone keeping a browser tab open. The gateway starts the browser, opens your world as that user and pairs the module.

Use it when the agent should be available all the time: a server-mode gateway, a remote client such as claude.ai, or a world with no GM online. The agent acts with that user's Foundry permissions and the same policy, approvals and audit as any other agent.

Headless agents need the npm or Docker install. The `.mcpb` bundle does not support them (see [below](#the-mcpb-bundle)).

## 1. Make a dedicated agent user in Foundry

1. In Foundry, create a user for the agent, for example "Assistant". Do not reuse a person's account.
2. **Give the user a password.** This is required. The gateway logs in to Foundry with it, and refuses an empty password. A Foundry user with no password can be logged into by anyone who reaches the world's `/join` page, so the gateway will not run one.
3. Find the user's id and the world's id. The module's pairing app has a "Copy my ids" line that shows both when you are logged in as that user. The world id is also the name of the world's folder under Foundry's `Data/worlds/`.
4. In the world, a GM turns on the world setting **Enable headless agents** (Configure Settings, then Agent Gateway). It is off until a GM turns it on. While it is off, the module refuses every call from a headless agent and tells the agent a GM must turn it on.
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

A headless agent is never picked by follow mode. A session started without `--user` binds to a person's browser pairing, never to a headless identity. To use the agent, bind to it explicitly with its world and user id:

```
claude mcp add foundry-agent -- node <repo>/gateway/dist/bin/cli.js --world my-world --user AbCdEf1234567890
```

A remote client reaches it through an OAuth grant that names it: on the consent page enter the world id and the agent's user, as in the [claude.ai guide](claude-ai.md).

## The browser

The gateway looks for a browser in this order: system Chrome, then Edge, then Chromium, then a Chromium it finds under `<state dir>/browsers/` (the state dir is the folder holding `gateway.db`, `~/.foundry-agent-gateway` by default). When it starts it logs one of:

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

Headless agents are not supported in the `.mcpb` bundle, because `playwright-core` is not bundled. If you configure one anyway the runner logs, once:

```
playwright-core is not installed; the headless runner needs the npm or Docker install, not the .mcpb bundle
```

Use the npm or Docker install.

## In Docker

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

`headless add`, `list`, `remove` (both outputs above), the missing-password and no-browser log lines, and the Docker commands were run against a freshly built image on Debian's Chromium. The AppArmor profile and the AppArmor failure were not reproduced for this guide. The runner log line for a missing Foundry server, `headless runner: cannot read http://localhost:30000/api/status: fetch failed (ECONNREFUSED)`, is what you see when the Foundry URL is wrong or Foundry is down.
