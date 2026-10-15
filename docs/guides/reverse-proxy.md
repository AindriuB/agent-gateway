# Put the gateway behind a reverse proxy

A gateway that remote clients (claude.ai, ChatGPT, Gemini) or other people's Foundry browsers reach must be served over HTTPS. The gateway never does TLS itself. A reverse proxy on the same machine terminates TLS and passes plain HTTP and WebSocket traffic to the gateway on loopback. This guide gives the proxy side for Caddy and nginx. The gateway side is `--public-url`; [server mode](../server-mode.md) and [gateway/docker/README.md](../../gateway/docker/README.md) cover the Docker Compose stack that already includes Caddy.

## What the proxy must do

The gateway listens on two loopback ports, and the proxy splits traffic between them:

| Path | Goes to | What it is |
| --- | --- | --- |
| `/link` (and anything under it) | `127.0.0.1:7420` | The WebSocket the Foundry module connects to (`wss://<host>/link`). |
| everything else | `127.0.0.1:7421` | `/mcp`, `/status`, the OAuth endpoints (`/.well-known/...`, `/register`, `/authorize`, `/token`) and the consent page. |

Use a host name of its own, for example `gateway.example.com`, never a path under your Foundry host. The public URL must be a bare origin, the gateway serves at its root, and the consent page's `__Host-` cookie is scoped to the whole host.

Start the gateway with the public URL and `--trust-proxy`:

```
node <repo>/gateway/dist/bin/cli.js --server-mode --public-url https://gateway.example.com --trust-proxy --allow-origin https://foundry.example.com
```

(`--server-mode` is for a gateway that stays up on a server; for a single person who needs a public URL, leave it out. In the Compose stack these are the environment variables `AGENT_GATEWAY_SERVER_MODE`, `AGENT_GATEWAY_PUBLIC_URL`, `AGENT_GATEWAY_TRUST_PROXY` and `AGENT_GATEWAY_ALLOW_ORIGIN`.)

With a public URL the gateway turns the static HTTP bearer off, checks the `Host` and `Origin` headers against that URL, prints pairing codes only in the operator's log, and shows only the version and uptime on `/status`. See [Public mode](../security.md#public-mode-behind-a-reverse-proxy--task-74).

## Caddy

Caddy gets the certificate by itself and handles the WebSocket upgrade with no extra configuration. It also sets `X-Forwarded-For`. This is the site block the Compose stack uses (`gateway/docker/byo-caddy.Caddyfile`):

```
gateway.example.com {
	# The module's WebSocket link.
	handle /link* {
		reverse_proxy 127.0.0.1:7420
	}
	# /mcp, /status, the OAuth endpoints and the consent page.
	handle {
		reverse_proxy 127.0.0.1:7421
	}
}
```

## nginx

nginx needs the `Host` header passed on unchanged, and the upgrade headers on `/link`. Without `proxy_set_header Host $host` the gateway sees the upstream address, not your public host, and refuses the request. TLS certificates come from your own tooling (for example certbot); the paths below are examples.

```
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name gateway.example.com;

    ssl_certificate     /etc/letsencrypt/live/gateway.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gateway.example.com/privkey.pem;

    # The module's WebSocket link.
    location /link {
        proxy_pass http://127.0.0.1:7420;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 1h;
    }

    # /mcp, /status, the OAuth endpoints and the consent page.
    location / {
        proxy_pass http://127.0.0.1:7421;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_buffering off;
    }
}
```

`proxy_buffering off` keeps streamed MCP responses from being held back. The long `proxy_read_timeout` stops nginx closing an idle link after its 60 second default.

Do not use `$proxy_add_x_forwarded_for` here: it appends to whatever the caller sent, so a caller can put a made-up address in front of the real one. `$remote_addr` replaces the header with the address nginx actually saw.

## Why `--trust-proxy`, and why only from loopback

Per-client rate limits (registration, `/authorize`, `/token`, failed pairing codes) are keyed by client address. Behind a proxy every connection arrives from the proxy, so without help they would all share one bucket and one client could lock out the rest. `--trust-proxy` (`AGENT_GATEWAY_TRUST_PROXY=1`) tells the gateway to key clients by the address in `X-Forwarded-For` instead.

That header is just text a caller can write. The gateway therefore reads it only when the connection itself comes from a loopback address (the proxy on the same machine), and then takes the right-most entry, the one the proxy added. A connection from any other address is keyed by its own address. This is also why the proxy must run on the same host, or share the gateway's network namespace as the Compose stack does: through a shared Docker network the proxy arrives from a container address, the header is ignored and every client shares one bucket.

Without `--trust-proxy` the gateway still works and logs `--trust-proxy is off: if a reverse proxy is in front, every client shares one rate-limit bucket`. Any other process on the same machine can send its own `X-Forwarded-For` to the loopback ports and so choose its own bucket; the ports are not reachable from off the machine as long as they stay bound to loopback.

## Why the gateway never does TLS

Certificates need renewal, a trust chain and an account with a certificate authority, and every proxy already does that well. Keeping it out of the gateway means one fewer thing to get wrong, and keeps the gateway's own listeners on loopback, where nothing off the machine can reach them. The only addresses the gateway will bind to anything other than loopback are the ones you pass with `--link-host` and `--http-host`, and it refuses those without `--public-url`. Leave them at the default behind a proxy.

## Checking it

```
curl https://gateway.example.com/status
curl -i https://gateway.example.com/.well-known/oauth-authorization-server
```

The first returns the version and uptime only. The second returns the OAuth metadata, whose `issuer` is your public URL. In Foundry, set the module's gateway URL to `wss://gateway.example.com/link`. If the module cannot connect, the usual causes are a missing `Upgrade` header on `/link`, a `Host` header that is not your public host, or `--allow-origin` not naming your Foundry origin.
