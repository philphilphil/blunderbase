# Konfiguration

Jede Einstellung ist eine Umgebungsvariable mit dem Präfix `BLUNDERBASE_`. Setz sie im
`environment:`-Block der Compose-Datei, in der Shell, die den Prozess startet, oder so, wie
deine Prozessverwaltung das macht.

Eine Variable, die zwar da, aber leer ist, gilt als *nicht gesetzt*: eine auskommentierte
Zeile, die jemand einkommentiert und leer gelassen hat, fällt auf den Standardwert zurück,
statt den Start zu verweigern.

Nicht alles ist eine Variable. Die Engine-Budgets, die Schwellen für die Zugbewertung, die
Maia-Wertung, das Intervall der automatischen Synchronisierung und das Token für den
Lichess-Explorer stehen in der Datenbank und werden in der App bearbeitet, denn das sind
die Werte, die du änderst, wenn sich dein Spiel ändert. Sie gelten ab dem nächsten Klick,
nicht ab dem nächsten Neustart. Siehe [Analyse](../guide/analysis.md) und
[Einstellungen](../guide/settings.md).

## Pfade { #paths }

| Variable | Standard | Wirkung |
|---|---|---|
| `BLUNDERBASE_ROOT` | Das Installationsverzeichnis | Wogegen jeder relative Pfad hier unten aufgelöst wird |
| `BLUNDERBASE_DATA_DIR` | `<root>/data` | Alles Geschriebene außer der Datenbank: hochgeladene PGN-Dateien, heruntergeladene Engines und Gewichte. Im Docker-Image `/data` |
| `BLUNDERBASE_DB_PATH` | `<data dir>/blunderbase.db` | Die SQLite-Datei. Im Docker-Image `/data/blunderbase.db` |
| `BLUNDERBASE_WEB_DIST` | `<root>/web/dist` | Die gebaute Web-App, ausgeliefert von demselben Prozess. Ein Verzeichnis, das nicht da ist, wird einfach nicht ausgeliefert |
| `BLUNDERBASE_MANUAL_DIR` | `<root>/manual-site` | Dieses Handbuch, unter `/manual` ohne Anmeldung ausgeliefert, damit es zur laufenden Version passt und ohne Weg ins Internet funktioniert. Ein Verzeichnis, das nicht da ist, wird einfach nicht ausgeliefert |

## Laufzeit und Zugang { #runtime-and-access }

| Variable | Standard | Wirkung |
|---|---|---|
| `BLUNDERBASE_RUNTIME_MODE` | `server` | `server`, `desktop` oder `demo`. `desktop` ist der Modus der Desktop-Anwendung und braucht `BLUNDERBASE_DESKTOP_TOKEN`. `demo` ist der öffentliche, schreibgeschützte Modus: kein Passwort, kein `/mcp`, jeder Schreibzugriff antwortet `403 read_only`, und Runner nur mit Token, die die Quellbibliothek schon hatte. Immer nur für eine Datenbank, die `blunderbase demo create` gebaut hat |
| `BLUNDERBASE_DESKTOP_TOKEN` | leer | Das Geheimnis, mit dem die Desktop-Anwendung ihr eigenes Fenster anmeldet, bei jedem Start ein neues. 64 hexadezimale Kleinbuchstaben, im Modus `desktop` Pflicht. Die native Anwendung setzt es, du nicht |
| `BLUNDERBASE_MCP_BEARER_KEY` | leer | Ein weiteres Token, das `/mcp` akzeptiert, neben den unter Assistent erzeugten Schlüsseln und dem Passwort des Besitzers. Für Compose-Dateien und Automatisierung |
| `BLUNDERBASE_CROSS_ORIGIN_ISOLATION` | `true` | Die Seite mit `Cross-Origin-Opener-Policy: same-origin` und `Cross-Origin-Embedder-Policy: require-corp` ausliefern. Das will ein Browser sehen, bevor er einem Tab einen `SharedArrayBuffer` gibt – und ohne den läuft eine Engine im Browser mit einem Thread. Der Preis ist, dass jede Cross-Origin-Subressource per `Cross-Origin-Resource-Policy` zustimmen muss oder blockiert wird; der Build lädt keine. Schalt es aus hinter einem Proxy, der diese Header umschreibt, oder für eine Seite, die eine Ressource von woanders laden muss |

## Netzwerk { #network }

| Variable | Standard | Wirkung |
|---|---|---|
| `BLUNDERBASE_HOST` | `127.0.0.1` | Woran `serve` bindet. Das Docker-Image startet mit `0.0.0.0` |
| `BLUNDERBASE_PORT` | `8765` | Der Port, an den `serve` bindet. `blunderbase mcp --transport http` nimmt diesen plus eins |
| `BLUNDERBASE_PUBLIC_URL` | leer | Wie diese Installation von außen erreicht wird. Wird in die `runner.yaml` geschrieben, die beim Anlegen eines Runners herauskommt; leer heißt, die anfragende Herkunft wird genommen. Trag hier die URL des Proxys ein. Siehe [Hinter einem Proxy](deploy.md) |

## Analyse { #analysis }

| Variable | Standard | Wirkung |
|---|---|---|
| `BLUNDERBASE_ANALYSIS_CONCURRENCY` | Die Kerne der Maschine minus zwei, nie unter 1 | Engine-Prozesse gleichzeitig, über alle Stufen hinweg. Das begrenzt die CPU, nicht die Verbindungen |
| `BLUNDERBASE_ANALYSIS_WORKERS` | `true` | Ob dieser Prozess die Analyse-Worker selbst betreibt. Schalt es aus für eine Installation, die die Warteschlange mit `blunderbase analyze` nach einem eigenen Zeitplan abarbeitet, und für die schreibgeschützte Demo |
| `BLUNDERBASE_ANALYSIS_POLL_SECONDS` | `1.0` | Wie lange ein untätiger Worker wartet, bevor er wieder in die Warteschlange schaut |
| `BLUNDERBASE_AUTO_SYNC_POLL_SECONDS` | `60.0` | Wie oft der geplante Import auf die Uhr schaut. Das Intervall selbst ist eine Einstellung in der App, voreingestellt aus; hier steht also nur, wie spät eine Synchronisierung höchstens dran sein kann |

## Das Analysebrett { #the-analysis-board }

Das laufende Brett, das sich ständig aktualisiert. Siehe [Analyse](../guide/analysis.md).

| Variable | Standard | Wirkung |
|---|---|---|
| `BLUNDERBASE_STREAM_SNAPSHOT_INTERVAL` | `0.5` | Wie oft eine laufende Suche einen neuen Schnappschuss veröffentlicht, in Sekunden |
| `BLUNDERBASE_STREAM_IDLE_SECONDS` | `30.0` | Wie lange eine Sitzung überlebt, der niemand zuhört, bevor sie ihren Slot freigibt |
| `BLUNDERBASE_STREAM_MAX_SESSIONS` | `3` | Analysebretter gleichzeitig. Eines je Oberfläche: das Partiebrett, das Live-Brett und die Begleitanwendung |

## Runner { #runners }

Diese liest der **Server**, über die Runner, die mit ihm verbunden sind. Der Runner-Prozess
liest seinen eigenen Satz, weiter unten aufgelistet. Siehe [Remote Runner](runners.md).

| Variable | Standard | Wirkung |
|---|---|---|
| `BLUNDERBASE_RUNNER_HEARTBEAT_SECONDS` | `10.0` | Wie oft der Server einen verbundenen Runner anpingt |
| `BLUNDERBASE_RUNNER_POLL_SECONDS` | `5.0` | Wie oft ein Runner, der auf HTTP zurückgefallen ist, wieder nach Arbeit fragt |
| `BLUNDERBASE_RUNNER_STALE_SWEEP_SECONDS` | `20.0` | Wie oft der Server nach Durchläufen sucht, die ein Runner liegen gelassen hat |

Jede davon hat einen Standardwert, eine Installation ohne registrierte Runner verhält sich
also genau so, wie sie es vor den Runnern tat.

## Vom Runner-Prozess gelesen { #read-by-the-runner-process }

Setz diese dort, wo `blunderbase-runner` läuft, nicht auf dem Server. Jede hat Vorrang vor
dem gleichnamigen Schlüssel in `runner.yaml`.

| Variable | Wirkung |
|---|---|
| `BLUNDERBASE_RUNNER_CONFIG` | Die `runner.yaml`, die gelesen wird, wenn `--config` fehlt |
| `BLUNDERBASE_RUNNER_SERVER` | Die Server-URL, die angewählt wird |
| `BLUNDERBASE_RUNNER_TOKEN` | Das Token des Runners |
| `BLUNDERBASE_RUNNER_NAME` | Der Name des Runners |
| `BLUNDERBASE_RUNNER_SLOTS` | Engine-Aufträge und Analysebretter gleichzeitig |

## Nicht von uns { #not-ours }

`FORWARDED_ALLOW_IPS` gehört uvicorn, dem Server darunter. Es entscheidet, welchen Adressen
bei `X-Forwarded-Proto` und dessen Geschwistern vertraut werden darf, und steht
voreingestellt auf `127.0.0.1`. Ein Proxy in einem anderen Container braucht seine Adresse
hier, damit die App weiß, dass die Anfrage über TLS kam. Siehe
[Hinter einem Proxy](deploy.md#settings-worth-knowing).
