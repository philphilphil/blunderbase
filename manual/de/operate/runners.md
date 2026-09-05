# Remote Runner

Ein **Runner** ist ein zweiter Blunderbase-Prozess auf einer Maschine mit freien Kernen. Er
hat keine Datenbank und liefert keine Seite aus. Er meldet sich *von sich aus* bei deinem
Server, sagt, welche Engines er hat, und bekommt ganze Analyseaufträge und Analysebretter
zugeteilt. Einem fertigen Durchlauf sieht man nicht an, wo er gelaufen ist.

Nimm einen, wenn die Maschine, auf der Blunderbase läuft, nicht die Maschine ist, die rechnen
soll.

## 1. Den Runner auf dem Server registrieren { #1-register-the-runner-on-the-server }

Auf dem Server:

```console
$ blunderbase runners create gpu-box --slots 8
runner 'gpu-box' registered with 8 slot(s)
This token is shown once. Save the yaml below as runner.yaml on that machine:

# blunderbase runner — blunderbase-runner --config runner.yaml
# The token below is shown once. Keep this file readable only by the runner.
server: "https://blunderbase.example.com"
token: "bb_rnr_kY3…"
name: "gpu-box"
slots: 8
engines:
  # One entry per engine on THIS machine. Edit the paths before starting.
  - name: sf-remote
    path: /usr/games/stockfish
    options:
      Threads: 8
```

**Externen Runner hinzufügen** unter **Rechenkapazität** auf der Engines-Seite tut dasselbe
und antwortet mit demselben yaml. So
oder so wird das Token einmal herausgegeben und nie wieder: Gespeichert wird nur sein
SHA-256. Ein verlorenes Token heißt widerrufen und einen neuen Runner anlegen, und das kostet
nichts.

`--server` überschreibt die URL, die ins yaml geschrieben wird. Ohne die Option nimmt der
Befehl `BLUNDERBASE_PUBLIC_URL` und, wenn auch das fehlt, die Adresse, an die sich der
Serverprozess bindet. Setz `BLUNDERBASE_PUBLIC_URL` bei einer Installation hinter einem
Proxy – der Server kann sonst nicht wissen, wie er von außen heißt. Siehe
[Hinter einem Proxy](deploy.md#settings-worth-knowing).

## 2. `runner.yaml` auf der anderen Maschine schreiben { #2-write-runneryaml-on-the-other-machine }

Jeder Schlüssel, mit seiner Voreinstellung.

### Oberste Ebene { #top-level }

| Schlüssel | Voreinstellung | Was es ist |
|---|---|---|
| `server` | erforderlich | Die `http`- oder `https`-URL deiner Blunderbase. Die `ws`/`wss`-URL wird daraus abgeleitet |
| `token` | erforderlich | Aus `runners create`, einmalig angezeigt |
| `name` | erforderlich | Nur zur Information – die Identität ist das Token |
| `slots` | `1` | Engine-Aufträge plus Analysebretter gleichzeitig |
| `verify_tls` | `true` | Ob das Zertifikat des Servers geprüft wird |
| `poll_seconds` | `5.0` | Wie oft der HTTP-Rückfallweg nach Arbeit fragt |
| `log_level` | `info` | `debug`, `info`, `warning` oder `error` |
| `reconnect` | siehe unten | Wie hartnäckig der Runner zurückzukommen versucht |
| `engines` | `[]` | Ein Eintrag je Datei auf dieser Maschine |

### `reconnect` { #reconnect }

| Schlüssel | Voreinstellung | Was es ist |
|---|---|---|
| `initial_seconds` | `1.0` | Untergrenze des Backoffs, mit Jitter |
| `max_seconds` | `60.0` | Obergrenze des Backoffs |
| `websocket_failures` | `3` | Fehlschläge *beim Verbinden*, bevor der Runner auf Polling zurückfällt |
| `retry_websocket_seconds` | `60.0` | Wie oft ein pollender Runner den Socket erneut versucht |

### Ein Eintrag unter `engines` { #an-entry-under-engines }

| Schlüssel | Voreinstellung | Was es ist |
|---|---|---|
| `name` | erforderlich | Eindeutig auf dieser Maschine; wird zum Namen der Engine auf dem Server |
| `path` | erforderlich | Der Pfad auf **dieser** Maschine; eine Datei oder eine vollständige Kommandozeile |
| `kind` | `uci` | `uci` oder `maia` |
| `options` | `{}` | UCI-Optionen, beim Start gegen das geprüft, was die Datei meldet |
| `streams` | `true` bei `uci` | Ob diese Engine ein Analysebrett steuern darf. Eine Maia streamt nie, egal was hier steht |
| `instances` | ein Prozess je Slot | Wie viele Kopien dieser Datei gleichzeitig laufen dürfen |
| `tier` | – | Wird angenommen und ignoriert. Eine Datei, die vor den Rollen geschrieben wurde, startet trotzdem |

Eine ganze Datei:

```yaml
# erforderlich
server: https://blunderbase.example.com
token: bb_rnr_…
name: gpu-box

# optional
slots: 4
verify_tls: true
poll_seconds: 5.0
log_level: info

reconnect:
  initial_seconds: 1.0
  max_seconds: 60.0
  websocket_failures: 3
  retry_websocket_seconds: 60.0

engines:
  - name: sf-remote
    path: /usr/games/stockfish
    kind: uci
    options:
      Threads: 8
      Hash: 4096
    streams: true
    instances: 2

  - name: maia3
    path: /engines/maia3/bin/maia3-5m
    kind: maia
    instances: 1   # ein GPU-Prozess für alle Slots zusammen
```

`instances` ist das Einzige, was eine Engine darüber sagen kann, *wie* sie ausgeführt wird.
Ohne die Angabe bekommt jeder Slot, der diese Engine will, seinen eigenen Prozess – richtig
für eine CPU-Datei und falsch für alles, was einen einzelnen Beschleuniger belegt: Eine Maia
auf einer GPU will `instances: 1`, damit sich die Slots an einem Prozess anstellen, statt
einen zweiten zu starten und der Karte den Speicher leer zu räumen. Die Angabe kann die Zahl
der Prozesse nur senken, nie über `slots` hinaus erhöhen.

**Ein unbekannter Schlüssel wird namentlich abgelehnt statt ignoriert.** Ein Tippfehler in
einer Slot-Zahl ist ein Fehler und keine Vorliebe, und die Ablehnung nennt das Feld und die
Datei, aus der es kam.

Ein Runner meldet, was er *hat*, und behauptet nichts darüber, wofür er *da ist*. Welche
Engine Schnell, Tief und Menschliche Züge bedient, wird auf der Seite
[Engines](engines.md) vergeben.

Vier Werte können aus der Umgebung statt aus der Datei kommen und schlagen die Datei, damit
ein Token nicht in etwas liegen muss, das herumkopiert wird:

| Variable | Ersetzt |
|---|---|
| `BLUNDERBASE_RUNNER_CONFIG` | Den Pfad zu `runner.yaml`, wenn `--config` fehlt |
| `BLUNDERBASE_RUNNER_SERVER` | `server` |
| `BLUNDERBASE_RUNNER_TOKEN` | `token` |
| `BLUNDERBASE_RUNNER_NAME` | `name` |
| `BLUNDERBASE_RUNNER_SLOTS` | `slots` |

Ganz ohne Datei sind diese Variablen die komplette Konfiguration – genau das tut ein
Container, der nichts mountet.

## 3. Starten { #3-start-it }

```console
$ blunderbase-runner --config runner.yaml --check
sf-remote: accepted as engine 7
$ blunderbase-runner --config runner.yaml
```

`--check` fragt jede Datei ab, öffnet eine Verbindung, gibt aus, was der Server angenommen
hat, und beendet sich. Führ das aus, bevor du den Runner richtig startest, **nicht
regelmäßig**: Es öffnet eine zweite Verbindung mit demselben Token, und eine zweite
Verbindung übernimmt den Runner.

Exit-Codes:

| Code | Bedeutung |
|---|---|
| `0` | Der Runner wurde zum Anhalten aufgefordert und hat angehalten |
| `1` | Die Konfiguration ist falsch, oder es ließ sich nicht eine einzige Engine starten |
| `2` | Der Server hat die Protokollversion dieses Runners abgelehnt – aktualisier den Runner auf die Version des Servers |

`SIGINT` und `SIGTERM` bitten um ein sauberes Anhalten, statt eine Suche mitten im Frame
abzuwürgen.

## Als Container { #as-a-container }

Ein Runner ist dasselbe Image wie der Server, mit einem anderen Befehl, ohne Ports und ohne
Volumes außer dem yaml. Im Repository liegt eine Beispiel-Compose-Datei,
[`docker-compose.runner.yml`](https://github.com/philphilphil/blunderbase/blob/main/docker/docker-compose.runner.yml).
Leg sie zusammen mit `runner.yaml` in dasselbe Verzeichnis und starte sie:

```console
$ BLUNDERBASE_RUNNER_TOKEN=bb_rnr_… docker compose -f docker-compose.runner.yml up -d
```

Das Image bringt Stockfish unter `/usr/games/stockfish` mit. Einen Maia-Build und seine
Gewichte musst du selbst mounten – nimm beim Volume `./engines` das Kommentarzeichen weg und
registrier den Pfad als `kind: maia`.

Schalt den Healthcheck des Containers ab, wenn du den Service woanders hin kopierst: Er ruft
per curl eine API ab, die ein Runner nicht anbietet, sodass `docker compose ps` einen
tadellos arbeitenden Runner als „unhealthy“ ausweisen würde. Sieh stattdessen in die
Logzeilen.

**Setz TLS vor den Server.** Das Token ist ein Bearer-Credential in jedem Frame.
[Hinter einem Proxy](deploy.md) hat eine Caddyfile und eine nginx-Site, die das erledigen;
`server:` ist dann die `https`-URL, und der Socket wird daraus abgeleitet.

## Bei der Arbeit zusehen { #watching-it-work }

- `blunderbase runners list` – eine Zeile je Runner: verbunden oder nicht, seine Slots, die
  Engines, die er anbietet, und wie viel vom Rückstand nur er abarbeiten kann.
- **Rechenkapazität** auf der Engines-Seite – dieser Host und jeder Runner, jeweils mit den
  Engines, die er anbietet. Dort steht, auf welcher Maschine eine an einen Runner gebundene
  Engine liegt.
- Die Analyse-Warteschlange, nach Ziel aufgeteilt. Eine Warteschlange, die stillsteht, weil
  die Maschine mit dieser Engine offline ist, sieht genau wie eine lange Warteschlange aus,
  bis du hier nachschaust.
- Ein MCP-Client hat ein nur lesendes Werkzeug `runners_status`, das dasselbe Bild zeigt. Das
  Ausstellen und Widerrufen bleibt aus dem Chat heraus: Das ist Umgang mit Token.

## Wenn er sich nicht verbindet { #when-it-does-not-connect }

| Was du siehst | Was es ist |
|---|---|
| exit `1`, „server is required“ | Die Datei oder die Umgebung ist unvollständig; die Meldung nennt das Feld und die Datei |
| exit `1`, ein fehlgeschlagenes Abfragen | Der `path` einer Engine stimmt auf *dieser* Maschine nicht |
| exit `2` | Der Server spricht eine andere Protokollversion – aktualisier den Runner |
| Close-Code `4401`, dann exit | Das Token gehört zu keinem registrierten Runner; stell ein neues aus |
| Close-Code `4403` | Der Runner wurde widerrufen, während er verbunden war |
| Close-Code `4409` | Eine zweite Verbindung mit demselben Token hat ihn übernommen – meist ein `--check`-Lauf oder zwei Kopien des Containers |
| Close-Code `4426` | Die beiden Seiten sprechen nicht dasselbe Runner-Protokoll; der Prozess endet mit `2` |
| Close-Code `4429` | Dieses Token wurde so oft abgewiesen, dass der Server ihm die Tür zugemacht hat. Weiter anzuklopfen hält sie nur zu – reparier das Token und warte. Ab zehn Fehlschlägen läuft ein Backoff, der sich von einer Sekunde auf eine Minute verdoppelt |
| im Log steht „polling“ | Der Socket ist dreimal fehlgeschlagen. Der Runner arbeitet weiter, über HTTP, und versucht den Socket jede Minute erneut |

## Widerrufen { #revoking }

```console
$ blunderbase runners revoke gpu-box
```

**Widerrufen** auf der Karte des Runners unter **Rechenkapazität** tut dasselbe. So oder so
hört das Token auf zu funktionieren, und die
Engines, die es angeboten hat, werden gelöscht.

Ein Widerruf aus der App schließt außerdem die offene Verbindung und gibt zurück, was der
Runner gerade gerechnet hat, mit erstattetem Versuch – eine Maschine, die du weggenommen
hast, ist nicht gescheitert. Die Kommandozeilen-Variante ist nicht der Serverprozess und kann
deshalb keine Verbindung schließen, die sie nicht hält: Sie löscht die Engines, der Runner
bekommt keine Arbeit mehr, und die Verbindung endet beim nächsten Reconnect.

Durchläufe, die gerade unterwegs waren, werden so oder so wieder eingereiht. Die Datenbank
ist die Warteschlange; Runner sind entbehrlich.

## Ein Durchlauf, eine Maschine { #one-run-one-machine }

Die Bewertung eines Durchlaufs und sein Durchgang für menschliche Züge laufen im selben
Prozess, beide Engines müssen also auf demselben Host liegen – *bei einem Durchlauf, der
beides anfordert*.

Eine Suchengine auf einer Maschine ohne Maia wird in einer Installation, deren einzige Maia
woanders liegt, schon beim Einreihen der Analyse abgelehnt, unter Nennung beider Maschinen.
Ein Durchlauf, der ganz ohne Maia-Durchgang eingereiht wird, hat einen Durchgang und damit
einen Host und wird deswegen nie abgelehnt. Eine Installation ganz ohne Maia ist nicht
betroffen: Der Durchgang findet einfach nicht statt.
