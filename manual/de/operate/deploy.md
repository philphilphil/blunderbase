# Hinter einem Reverse Proxy betreiben

Blunderbase ist ein Prozess auf einem Port. Die Seite, die JSON-API, das WebSocket unter
`/events` und der Transport unter `/mcp` kommen alle aus derselben Origin. Ein Proxy davor
hat genau einen Grund: TLS. Das Sitzungs-Cookie trägt `Secure` auf jedem Host, der nicht
Loopback ist – eine Installation, die über einfaches HTTP erreicht wird, hält dich also
nicht angemeldet.

```
Browser    ─┐
            ├─▶ Proxy :443 ──▶ blunderbase :8765 ──▶ /  /api  /events  /mcp
MCP-Client ─┘
```

Veröffentliche den Port des Containers nur auf Loopback und lass den Proxy ihn dort
erreichen.

## Drei Regeln { #three-rules }

Alles Weitere ist diese drei Regeln, zweimal ausgeschrieben, einmal je Proxy.

1. **Reich `Authorization` unverändert durch.** Er ist die gesamte Authentifizierung von
   `/mcp`. Ein Proxy, der den Header für seine eigene Auth verbraucht oder ihn löscht,
   macht aus jeder MCP-Anfrage eine 401.
2. **Puffere `/mcp` und `/events` nicht.** `/mcp` antwortet mit Streamable HTTP – einem
   `text/event-stream`, der offen bleibt – und `/events` ist ein WebSocket. Ein Proxy, der
   erst die ganze Antwort einsammelt, bevor er sie weiterreicht, reicht nie eine weiter.
3. **Leite `/mcp` nicht um.** Es ist ein einzelner Pfad, kein Verzeichnis: kein Rewrite,
   kein abschließender Schrägstrich, kein `301` oder `307` auf `/mcp/`. Ein MCP-Client, der
   JSON-RPC postet, hat keinen Grund, einer Umleitung zu folgen, und die meisten tun es
   nicht.

## Caddy { #caddy }

```caddyfile
blunderbase.example.com {
	# Der MCP-Transport und das Event-Socket der Oberfläche streamen beide. `flush_interval -1`
	# reicht jedes Byte weiter, sobald es ankommt, statt auf eine Antwort zu warten, die nie endet.
	@stream path /mcp /events
	reverse_proxy @stream 127.0.0.1:8765 {
		flush_interval -1
	}

	reverse_proxy 127.0.0.1:8765
}
```

Das ist die ganze Datei. Caddy terminiert TLS selbst, reicht `Authorization` weiter und
setzt `X-Forwarded-*`, ohne gefragt zu werden, und `reverse_proxy` erfindet nie eine
Umleitung auf einen abschließenden Schrägstrich – `path /mcp` trifft genau `/mcp` und
nichts sonst.

Läuft der Proxy als Container neben diesem, wird aus `127.0.0.1:8765` der Servicename:
`reverse_proxy blunderbase:8765`. Wenn du `encode` ergänzt, nimm die beiden streamenden
Pfade davon aus – ein Kompressor ist ein Puffer.

## nginx { #nginx }

nginx verwirft *jeden* geerbten `proxy_set_header`, sobald eine location einen eigenen
deklariert. Der gemeinsame Satz liegt deshalb in einem Snippet, das jede location einbindet,
statt auf Server-Ebene.

`/etc/nginx/snippets/blunderbase-proxy.conf`:

```nginx
proxy_http_version 1.1;
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
# Standardmäßig weitergereicht; hier ausgeschrieben, damit eine Überschreibung auf
# Server-Ebene nicht stillschweigend den einen Header entfernt, mit dem sich /mcp
# authentifiziert.
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

	# Ein PGN-Export von zehn Jahren Partien ist ein einziger Request-Body.
	client_max_body_size 64m;

	# `location =` und ein proxy_pass ohne URI-Teil: der Pfad erreicht die App genau so,
	# wie er gesendet wurde, und nichts hier kann einen JSON-RPC-POST mit einer Umleitung
	# auf /mcp/ beantworten.
	location = /mcp {
		include snippets/blunderbase-proxy.conf;
		proxy_pass http://blunderbase;
		# Streamable HTTP in beide Richtungen, offen gehalten, solange der Client arbeitet.
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

## Nachprüfen { #check-it }

Der MCP-Endpunkt durch den Proxy ist `https://<dein Host>/mcp`, und der Header lautet
`Authorization: Bearer <ein Schlüssel von der Seite Assistent oder dein Passwort>`. Zwei
curl-Aufrufe sagen dir, ob der Proxy aus dem Weg gegangen ist.

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

Was die Fehler bedeuten:

| Was du siehst | Was es ist |
|---|---|
| `301` oder `307` auf `/mcp/` | Regel 3: ein Rewrite oder eine Umleitung auf den abschließenden Schrägstrich im Proxy |
| `200` mit HTML | Die Anfrage ist beim Fallback der Web-App gelandet, nicht bei `/mcp` – die location trifft nicht |
| `401` mit einem Schlüssel, von dem du weißt, dass er stimmt | Regel 1: Der Header kommt nicht an – oder der Schlüssel wurde unter Assistent widerrufen |
| Der zweite curl-Aufruf hängt ohne Ausgabe | Regel 2: Die Antwort wird gepuffert |
| `502` nach genau 60s | Ein Read-Timeout kürzer als der längste MCP-Tool-Aufruf |

Dann trag ihn in einem Client ein:

```bash
claude mcp add --transport http blunderbase https://blunderbase.example.com/mcp \
  --header "Authorization: Bearer <a key from Assistant, or your password>"
```

## Einstellungen, die hier zählen { #settings-worth-knowing }

Die vollständige Liste ist [Konfiguration](configuration.md); drei davon spielen hier eine
Rolle.

`BLUNDERBASE_PUBLIC_URL` ist die Adresse, unter der diese Installation von außen erreicht
wird. Sie wird in die `runner.yaml` geschrieben, die beim Anlegen eines Runners
herauskommt; ohne sie kann der Server nur aus der Anfrage raten, die er gerade beantwortet.
Setz sie auf die URL des Proxys. Die Verbindung des Runners trägt in jedem Frame ein
Bearer-Token, sie sollte also `https://` sein, und der Runner leitet `wss://` daraus ab.
Siehe [Remote Runner](runners.md).

`FORWARDED_ALLOW_IPS` ist eine Variable von uvicorn, keine von Blunderbase. Sie vertraut
`X-Forwarded-Proto` und seinen Geschwistern standardmäßig nur von `127.0.0.1`. Ein Proxy in
einem anderen Container braucht deshalb seine Adresse – oder `*` in einem Netz, das nur der
Proxy erreicht –, damit die App weiß, dass die Anfrage über TLS kam.

`BLUNDERBASE_CROSS_ORIGIN_ISOLATION` ist voreingestellt an und das Einzige hier, was ein
Proxy stillschweigend kaputt machen kann. Die Seite wird mit
`Cross-Origin-Opener-Policy: same-origin` und `Cross-Origin-Embedder-Policy: require-corp`
ausgeliefert, dem Preis, den der Browser für `SharedArrayBuffer` verlangt – und eine Engine
im Tab läuft ohne den auf einem Thread. **Reich beide Response-Header unverändert durch**,
so wie Regel 1 es für `Authorization` verlangt. Weder Caddy noch die nginx-Snippets oben
fassen einen Response-Header an, aber ein Proxy, der seine eigene Policy setzt oder
entfernt, was er nicht selbst gesetzt hat, nimmt die Threads weg, ohne dass irgendwo ein
Fehler auftaucht. Der Preis dafür, das anzulassen: jede Subresource aus einer fremden
Origin, die die Seite lädt, muss mit `Cross-Origin-Resource-Policy` zustimmen – der Build
lädt keine. Setz die Variable auf `false`, wenn dein Proxy diese Header umschreibt oder
wenn du ein Asset aus einer anderen Origin ergänzt hast: die Seite arbeitet dann genau wie
vorher, nur auf einem Thread.

## Eine öffentliche Demo, schreibgeschützt { #a-read-only-public-demo }

Blunderbase kann eine Bibliothek für alle ausliefern, schreibgeschützt und ohne Passwort.
Genau das ist `demo.blunderbase.org`. Betreib das nur auf einer Datenbank, die
[`blunderbase demo create`](cli.md#demo) gebaut hat, nie auf einer echten Bibliothek.

Im Demo-Modus steht die Tür offen und jeder Schreibzugriff ist zu: Der Wächter lässt jede
Anfrage durch, und eine zweite Prüfung weist alles außer `GET`, `HEAD` und `OPTIONS` mit
`403 read_only` ab. Ausgenommen sind drei Lesezugriffe, die als POST geschrieben sind und
keine Zeile anfassen – das Analysebrett, Maias Antwort für eine Stellung und eine einmalige
Engine-Bewertung –, damit die Partieansicht lebendig bleibt. `/mcp` wird gar nicht erst
eingehängt. Die Seite zeigt in der Titelleiste einen Chip *Demo · schreibgeschützt* und
beim ersten abgewiesenen Schreibzugriff einen Hinweis.

Zwei Lesezugriffe sind ebenfalls zu: die Datenbanksicherung und der PGN-Export der ganzen
Bibliothek. Beide kosten pro Anfrage Sekunden an Rechenzeit und liefern die komplette
Bibliothek als Datei, an jeden – eine Demo antwortet darauf mit demselben `403 read_only`.
Die Bibliothek ist ohnehin erfunden; wer eine Kopie will, lässt `blunderbase demo create`
auf dem eigenen Rechner laufen.

Drei Schritte.

**1. Bau die Bibliothek auf einem Rechner, der deine echte hat.** Jede Partie kommt mit
ihrer schon kopierten Analyse an, und das Ergebnis trägt keine Engine-Zeile, der Demo-Host
startet also nie eine Binärdatei.

```bash
blunderbase demo create --games 3000
```

Der Befehl baut den PGN-Text ohne Kommentare neu auf und erfindet jede identifizierende
Angabe; Zugangsdaten und persönliche Notizen werden nie kopiert.

**2. Starte den Stack und leg die Datei in sein Volume.**
Die Beispieldatei
[`docker-compose.demo.yml`](https://github.com/philphilphil/blunderbase/blob/main/docker/docker-compose.demo.yml)
im Repository ist die ganze Konfiguration: `BLUNDERBASE_RUNTIME_MODE=demo`, die Datenbank
unter `/data/demo.db`, die Worker aus, weil in einer schreibgeschützten Bibliothek nie etwas
eingereiht wird, ein niedrigeres `BLUNDERBASE_STREAM_MAX_SESSIONS` und Traefik-Labels statt
eines veröffentlichten Ports.

```bash
docker compose -f docker-compose.demo.yml up -d
docker cp demo.db blunderbase-demo:/data/demo.db
docker restart blunderbase-demo
```

Dieselben zwei Befehle frischen sie nach einem neueren `demo create` wieder auf.

**3. Gib ihr einen Hostnamen und behalt die Isolations-Header.** Mit einem weiteren Proxy
veröffentlichst du den Port auf Loopback und ergänzt eine Site in der Caddyfile oder der
nginx-Konfiguration von oben. Die drei Regeln gelten unverändert, und die Cross-Origin-
Isolation zählt hier mehr als irgendwo sonst: Stockfish im Browser ist die einzige Engine,
die ein Besucher haben kann. Ein Proxy, der `Cross-Origin-Opener-Policy` oder
`Cross-Origin-Embedder-Policy` entfernt, lässt das Analysebrett der Demo also ohne alles
dastehen. Ein `/mcp` gibt es auf einer Demo nicht, ein Proxy, der `/`, `/api` und `/events`
weiterreicht, reicht deshalb alles weiter, was es gibt.

Was ein Besucher den Rechner tun lassen kann, ist genauso begrenzt wie beim Besitzer:
höchstens `BLUNDERBASE_STREAM_MAX_SESSIONS` Analysebretter gleichzeitig, jedes
`BLUNDERBASE_STREAM_IDLE_SECONDS` nach dem Verschwinden seines Tabs verworfen, und einmalige
Bewertungen gedeckelt durch das Knotenbudget, das die Anfrage nennt. Jeder Schreibzugriff
wird an der Tür abgewiesen, es gibt zwischen Besuchern also nichts aufzuräumen.

Der Runner-Transport *ist* auf einer Demo eingehängt. Ein Runner wählt sich mit einem Token
ein, das nur du erzeugt hast, und eines zu erzeugen ist ein Schreibzugriff, den die Demo
abweist. `blunderbase demo create --runners` ist deshalb der Weg, einen deiner eigenen
Rechner hinter das Analysebrett der Demo zu stellen, ohne einem Besucher irgendetwas in die
Hand zu geben.
