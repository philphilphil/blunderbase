# Deploying behind a reverse proxy

Blunderbase is one process on one port. The page, the JSON API, the `/events` WebSocket
and the coach's `/mcp` transport are all the same origin — that is what makes the deployed
artifact a single container instead of three moving parts. A proxy in front of it exists
for one reason: TLS. The session cookie carries `Secure` on any host that is not loopback,
so a deployment reached over plain HTTP will not keep you signed in.

```
browser ─┐
         ├─▶ proxy :443 ──▶ blunderbase :8765 ──▶ /  /api  /events  /mcp
coach  ──┘
```

## Three rules

Everything below is those three rules written out twice, once per proxy.

1. **Pass `Authorization` through untouched.** It is the whole of `/mcp`'s authentication:
   the bearer token, which is a key minted on Assistant, your password, or
   `BLUNDERBASE_MCP_BEARER_KEY`. A proxy that consumes the header for its own auth, or clears it, turns every coach
   request into a 401.
2. **Do not buffer `/mcp` or `/events`.** `/mcp` answers streamable HTTP — the response is
   a `text/event-stream` that stays open — and `/events` is a WebSocket. A proxy that
   collects the whole response before forwarding it will simply never forward one.
3. **Do not redirect `/mcp`.** It is a single path, not a directory: no rewrite, no
   trailing slash, no `301`/`307` to `/mcp/`. An MCP client posting JSON-RPC has no reason
   to follow a redirect, and most will not — the symptom is a client that connects to
   nothing with no error worth reading.

## Caddy

```caddyfile
blunderbase.example.com {
	# The coach's transport and the UI's event socket both stream. `flush_interval -1`
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
`reverse_proxy blunderbase:8765`. If you add `encode`, exclude the two streaming paths
from it — a compressor is a buffer.

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
		# Streamable HTTP in both directions, held open for as long as the coach is working.
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

`make mcp-key` prints the URL and header for the local process
(`http://127.0.0.1:8765/mcp`); through the proxy the URL is your own host, and the header
is the same. Two curls say whether the proxy got out of the way:

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
| `301`/`307` to `/mcp/` | rule 3: a rewrite or a trailing-slash redirect in the proxy |
| `200` with HTML | the request reached the web app's SPA fallback, not `/mcp` — the location is not matching |
| `401` with a key you know is right | rule 1: the header is not arriving — or the key was revoked on Assistant |
| the second curl hangs with no output | rule 2: the response is being buffered |
| `502` after exactly 60s | a read timeout shorter than the coach's longest tool call |

Then add it to a client:

```bash
claude mcp add --transport http blunderbase https://blunderbase.example.com/mcp \
  --header "Authorization: Bearer <a key from Assistant, or your password>"
```

## Three settings worth knowing

`BLUNDERBASE_PUBLIC_URL` is how this deployment is reached from outside. It is written
into the `runner.yaml` the create-runner flow hands over; without it the server can only
guess from the request it is answering. Set it to the proxy's URL — the runner link
carries a bearer token on every frame, so it should be `https://`, and the runner derives
`wss://` from it. See `docs/runners.md`.

`FORWARDED_ALLOW_IPS` is uvicorn's, not ours: it trusts `X-Forwarded-Proto` and friends
only from `127.0.0.1` by default, so a proxy running in another container needs its
address (or `*` on a network only the proxy can reach) for the app to know the request
arrived over TLS.

`BLUNDERBASE_CROSS_ORIGIN_ISOLATION` is on by default, and it is the one thing here a
proxy can silently break. The page is served with `Cross-Origin-Opener-Policy:
same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, which is the browser's price
for `SharedArrayBuffer` — and an analysis engine running in a tab is single-threaded
without one. So **pass both headers through untouched**, the way rule 1 says to pass
`Authorization`: neither Caddy nor the nginx snippets above touch a response header, but a
proxy configured to add its own COOP or COEP, or to strip what it did not set, will take
the threads away with no error anywhere. The consequence of leaving it on is that every
**cross-origin** subresource the page loads must opt in with `Cross-Origin-Resource-Policy`
or the browser blocks it — the build loads none, so nothing is affected today, but a proxy
that injects a script tag from its own domain is. Set it to `false` in either case: the
page then works exactly as it did before, on one thread.
