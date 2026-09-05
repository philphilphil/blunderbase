# Deploy behind a reverse proxy

Blunderbase is one process on one port. The page, the JSON API, the `/events` WebSocket and
the `/mcp` transport are all the same origin. A proxy in front of it exists for one
reason: TLS. The session cookie carries `Secure` on any host that is not loopback, so an
installation reached over plain HTTP will not keep you signed in.

```
browser    ─┐
            ├─▶ proxy :443 ──▶ blunderbase :8765 ──▶ /  /api  /events  /mcp
MCP client ─┘
```

Publish the container's port on loopback only, and let the proxy reach it there.

## Three rules

Everything below is these three rules written out twice, once per proxy.

1. **Pass `Authorization` through untouched.** It is the whole of `/mcp`'s authentication.
   A proxy that consumes the header for its own auth, or clears it, turns every MCP
   request into a 401.
2. **Do not buffer `/mcp` or `/events`.** `/mcp` answers streamable HTTP — a
   `text/event-stream` that stays open — and `/events` is a WebSocket. A proxy that
   collects the whole response before forwarding it never forwards one.
3. **Do not redirect `/mcp`.** It is a single path, not a directory: no rewrite, no
   trailing slash, no `301` or `307` to `/mcp/`. An MCP client posting JSON-RPC has no
   reason to follow a redirect, and most will not.

## Caddy

```caddyfile
blunderbase.example.com {
	# The MCP transport and the UI's event socket both stream. `flush_interval -1`
	# forwards every byte as it arrives instead of waiting for a response that never ends.
	@stream path /mcp /events
	reverse_proxy @stream 127.0.0.1:8765 {
		flush_interval -1
	}

	reverse_proxy 127.0.0.1:8765
}
```

That is the whole file. Caddy terminates TLS itself, forwards `Authorization` and sets
`X-Forwarded-*` without being asked, and `reverse_proxy` never invents a trailing-slash
redirect — `path /mcp` matches exactly `/mcp` and nothing else.

If the proxy is a container beside this one, `127.0.0.1:8765` becomes the service name:
`reverse_proxy blunderbase:8765`. If you add `encode`, exclude the two streaming paths from
it — a compressor is a buffer.

## nginx

nginx discards *every* inherited `proxy_set_header` the moment a location declares one of
its own, so the common set lives in a snippet each location includes rather than at server
level.

`/etc/nginx/snippets/blunderbase-proxy.conf`:

```nginx
proxy_http_version 1.1;
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
# Forwarded by default; spelled out so a server-level override cannot silently drop the
# one header /mcp authenticates with.
proxy_set_header Authorization     $http_authorization;
```

`/etc/nginx/sites-available/blunderbase`:

```nginx
map $http_upgrade $connection_upgrade {
	default upgrade;
	''      close;
}

upstream blunderbase {
	server 127.0.0.1:8765;
	keepalive 16;
}

server {
	listen 443 ssl;
	http2 on;
	server_name blunderbase.example.com;

	ssl_certificate     /etc/letsencrypt/live/blunderbase.example.com/fullchain.pem;
	ssl_certificate_key /etc/letsencrypt/live/blunderbase.example.com/privkey.pem;

	# A PGN export of a decade of games is one request body.
	client_max_body_size 64m;

	# `location =` and a proxy_pass with no URI part: the path reaches the app exactly
	# as sent, and nothing here can answer a JSON-RPC POST with a redirect to /mcp/.
	location = /mcp {
		include snippets/blunderbase-proxy.conf;
		proxy_pass http://blunderbase;
		# Streamable HTTP in both directions, held open for as long as the client is working.
		proxy_buffering off;
		proxy_request_buffering off;
		proxy_cache off;
		proxy_set_header Connection '';
		proxy_read_timeout 1h;
		proxy_send_timeout 1h;
	}

	location /events {
		include snippets/blunderbase-proxy.conf;
		proxy_pass http://blunderbase;
		proxy_set_header Upgrade    $http_upgrade;
		proxy_set_header Connection $connection_upgrade;
		proxy_buffering off;
		proxy_read_timeout 1h;
	}

	location / {
		include snippets/blunderbase-proxy.conf;
		proxy_pass http://blunderbase;
	}
}
```

## Check it

The MCP endpoint through the proxy is `https://<your host>/mcp`, and the header is
`Authorization: Bearer <a key from Assistant, or your password>`. Two curls say whether the
proxy got out of the way.

```console
$ curl -i -sS https://blunderbase.example.com/mcp | head -3
HTTP/2 401
www-authenticate: Bearer realm="blunderbase"
content-type: application/json
```

```console
$ curl -sS -N https://blunderbase.example.com/mcp \
    -H "Authorization: Bearer $BLUNDERBASE_KEY" \
    -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":
         {"protocolVersion":"2026-07-28","capabilities":{},
          "clientInfo":{"name":"curl","version":"1"}}}'
event: message
data: {"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"blunderbase",…
```

What the failures mean:

| What you see | What it is |
|---|---|
| `301` or `307` to `/mcp/` | rule 3: a rewrite or a trailing-slash redirect in the proxy |
| `200` with HTML | the request reached the web app's fallback, not `/mcp` — the location is not matching |
| `401` with a key you know is right | rule 1: the header is not arriving — or the key was revoked on Assistant |
| the second curl hangs with no output | rule 2: the response is being buffered |
| `502` after exactly 60s | a read timeout shorter than the longest MCP tool call |

Then add it to a client:

```bash
claude mcp add --transport http blunderbase https://blunderbase.example.com/mcp \
  --header "Authorization: Bearer <a key from Assistant, or your password>"
```

## Settings worth knowing

The full list is [Configuration](configuration.md); three of them matter here.

`BLUNDERBASE_PUBLIC_URL` is how this installation is reached from outside. It is written
into the `runner.yaml` the create-runner flow hands over; without it the server can only
guess from the request it is answering. Set it to the proxy's URL. The runner link carries
a bearer token on every frame, so it should be `https://`, and the runner derives `wss://`
from it. See [Remote runners](runners.md).

`FORWARDED_ALLOW_IPS` is uvicorn's own variable, not a Blunderbase one. It trusts
`X-Forwarded-Proto` and its siblings only from `127.0.0.1` by default, so a proxy running in
another container needs its address — or `*` on a network only the proxy can reach — for
the app to know the request arrived over TLS.

`BLUNDERBASE_CROSS_ORIGIN_ISOLATION` is on by default and is the one thing here a proxy can
silently break. The page is served with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`, which is the browser's price for
`SharedArrayBuffer` — and an engine running in a tab is single-threaded without one.
**Pass both response headers through untouched**, the way rule 1 says to pass
`Authorization`. Neither Caddy nor the nginx snippets above touch a response header, but a
proxy configured to add its own policy, or to strip what it did not set, takes the threads
away with no error anywhere. The cost of leaving it on is that every cross-origin
subresource the page loads must opt in with `Cross-Origin-Resource-Policy`; the build loads
none. Set it to `false` if your proxy rewrites those headers, or if you have added an asset
from another origin: the page then works exactly as before, on one thread.

## A read-only public demo

Blunderbase can serve a library to everyone, read-only, with no password. That is what
`demo.blunderbase.org` is. Run it only on a database that
[`blunderbase demo create`](cli.md#demo) built, never on a real library.

In demo mode the door is open and every write is closed: the guard lets every request
through, and a second check refuses everything but `GET`, `HEAD` and `OPTIONS` with
`403 read_only`. The exceptions are three reads spelled as POSTs that touch no row — the
analysis board, Maia's answer for a position, and a one-off engine evaluation — so the game
view stays alive. `/mcp` is not mounted at all. The page shows a *Demo · read-only* chip in
the title bar and one toast the first time a write is refused.

Three steps.

**1. Build the library on a machine that has your real one.** Every game arrives with its
analysis already copied in and the result carries no engine row, so the demo host never
starts a binary.

```bash
blunderbase demo create --games 3000
```

It reconstructs PGN text without comments and fabricates every identifying detail;
credentials and personal notes are never copied.

**2. Run the stack and put the file in its volume.**
The sample
[`docker-compose.demo.yml`](https://github.com/philphilphil/blunderbase/blob/main/docker/docker-compose.demo.yml)
in the repository is the whole configuration: `BLUNDERBASE_RUNTIME_MODE=demo`, the database at
`/data/demo.db`, the workers off because nothing is ever queued in a read-only library, a
lower `BLUNDERBASE_STREAM_MAX_SESSIONS`, and Traefik labels instead of a published port.

```bash
docker compose -f docker-compose.demo.yml up -d
docker cp demo.db blunderbase-demo:/data/demo.db
docker restart blunderbase-demo
```

The same two commands refresh it after a newer `demo create`.

**3. Give it a hostname and keep the isolation headers.** With another proxy, publish the
port on loopback and add one more site to the Caddyfile or nginx config above. The three
rules apply unchanged, and cross-origin isolation matters more here than anywhere else:
browser Stockfish is the only engine a visitor can have, so a proxy that strips
`Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy` leaves the demo's analysis
board with nothing to run. There is no `/mcp` on a demo, so a proxy that forwards `/`,
`/api` and `/events` forwards everything there is.

What a visitor can make the machine do is bounded the way it is for the owner: at most
`BLUNDERBASE_STREAM_MAX_SESSIONS` analysis boards at once, each dropped
`BLUNDERBASE_STREAM_IDLE_SECONDS` after its tab goes away, and one-off evaluations capped by
the node budget the request names. Every write is refused at the door, so there is nothing
to clean up between visitors.

The runner transport *is* mounted on a demo. A runner dials in with a token only you
minted, and minting one is a write the demo refuses, so
`blunderbase demo create --runners` is how you put one of your own machines behind the
demo's analysis board without handing a visitor anything.
