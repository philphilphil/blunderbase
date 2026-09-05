# Kommandozeile

Installiert werden zwei Befehle: `blunderbase`, die Anwendung, und `blunderbase-runner`, der
[Remote Runner](runners.md).

Unter Docker stell allem hier unten `docker exec -it blunderbase` voran oder führ es einmalig
aus:

```bash
docker exec -it blunderbase blunderbase engines list
```

Beide lesen dieselbe [Konfiguration](configuration.md) wie der Server, `BLUNDERBASE_DB_PATH`
entscheidet also, welche Bibliothek ein Befehl anfasst.

```console
$ blunderbase --version
```

## serve { #serve }

Betreibt die HTTP-API, die Web-App, den Socket `/events`, `/mcp` und die Analyse-Worker.

```console
$ blunderbase serve --host 0.0.0.0 --port 8765
```

| Flag | Standard | Wirkung |
|---|---|---|
| `--host` | `BLUNDERBASE_HOST` | Die Adresse, an die gebunden wird |
| `--port` | `BLUNDERBASE_PORT` | Der Port, an den gebunden wird |
| `--reload` | aus | Bei einer Änderung am Quellcode neu starten |

## import { #import }

Importiert Partien aus einer Quelle. `pgn` liest eine Datei, die anderen synchronisieren ein
Konto.

```console
$ blunderbase import lichess yourname
$ blunderbase import pgn archive.pgn --not-mine
```

Die Quelle ist `lichess`, `chesscom`, `fics` oder `pgn`. Das zweite Argument ist das Konto,
das synchronisiert wird, oder die Datei, die gelesen wird.

| Flag | Wirkung |
|---|---|
| `--username` | Das Konto, das synchronisiert wird, statt des Positionsarguments |
| `--path` | Die PGN-Datei, die gelesen wird, statt des Positionsarguments |
| `--since` | Ab dieser Marke weitermachen statt ab der gespeicherten. `all` liest das ganze Archiv |
| `--max-games N` | Nach N Partien aufhören |
| `--not-mine` | Das PGN enthält fremde Partien: zum Studieren speichern, in keiner Statistik zählen |

Einen laufenden Import stoppst du mit Ctrl-C. Alles schon Importierte bleibt, und der nächste
Import macht dort weiter. Siehe [Bibliothek](../guide/library.md#import).

## accounts { #accounts }

Die Benutzernamen, die eine Partie zu deiner machen.

```console
$ blunderbase accounts list
$ blunderbase accounts add lichess yourname
$ blunderbase accounts reconcile
```

| Befehl | Wirkung |
|---|---|
| `blunderbase accounts list` | Jedes Konto und die Partien, die ihm zugeordnet sind |
| `blunderbase accounts add <platform> <username>` | Ein Konto registrieren und die Partien beanspruchen, die es schon gespielt hat. Die Plattform ist `lichess`, `chesscom`, `fics` oder `otb` |
| `blunderbase accounts reconcile` | Die Zuordnung zum Besitzer noch einmal über die schon gespeicherten Partien laufen lassen |

`reconcile` ist idempotent und ändert nie eine Partie, deren Seite schon bekannt ist. Es
trägt Farbe, Gegner und Wertungen bei einem Archiv nach, das importiert wurde, bevor
überhaupt ein Konto sagte, welcher Spieler du bist.

## runners { #runners }

Die Maschinen, die Engine-Arbeit rechnen dürfen. Ausführlich: [Remote Runner](runners.md).

```console
$ blunderbase runners list
$ blunderbase runners create gpu-box --slots 8
$ blunderbase runners revoke gpu-box
```

| Befehl | Wirkung |
|---|---|
| `blunderbase runners list` | Jeder Runner, was er anbietet und was bei ihm ansteht |
| `blunderbase runners create <name>` | Einen Runner registrieren und sein Token und seine `runner.yaml` ausgeben, ein einziges Mal |
| `blunderbase runners revoke <name>` | Einen Runner löschen, dazu sein Token und die Engines, die er angeboten hat |

`create` nimmt:

| Flag | Standard | Wirkung |
|---|---|---|
| `--slots N` | `1` | Engine-Aufträge gleichzeitig |
| `--server` | `BLUNDERBASE_PUBLIC_URL` | Wie der Runner diesen Server erreicht |

## engines { #engines }

Die Engine-Programme auf **dieser** Maschine. Ausführlich: [Engines](engines.md).

```console
$ blunderbase engines list
$ blunderbase engines add sf-local stockfish --option Threads=4 --role quick --role deep
$ blunderbase engines remove sf-local
```

| Befehl | Wirkung |
|---|---|
| `blunderbase engines list` | Jede Engine-Zeile, wo sie liegt und was sie bedient |
| `blunderbase engines add <name> <path>` | Ein Programm auf diesem Host registrieren und ihm wahlweise gleich seine Rollen geben |
| `blunderbase engines remove <name>` | Eine Engine-Zeile löschen und aus der Warteschlange nehmen, was nur sie hätte rechnen können |

`add` nimmt einen Pfad – eine Datei, eine Kommandozeile mit Argumenten oder einen Namen im
`PATH` – und:

| Flag | Standard | Wirkung |
|---|---|---|
| `--kind` | `uci` | `uci` oder `maia` |
| `--option NAME=VALUE` | — | Eine UCI-Option, geprüft gegen das, was das Programm angibt. Mehrfach möglich |
| `--role` | — | `quick`, `deep` oder `human`, weggenommen von dem, der die Rolle gerade hält. Mehrfach möglich. Ohne die Angabe werden nur unbesetzte Rollen gefüllt |
| `--replace` | aus | Die Engine dieses Namens aktualisieren, statt abzulehnen, und einschalten |
| `--disabled` | aus | Registrieren, ohne sie einzuschalten |

## analyze { #analyze }

Reiht Engine-Analysen ein und arbeitet die Warteschlange in diesem Prozess ab. Die
Warteschlange sind Zeilen in der Datenbank und kein Broker; das hier läuft also gefahrlos
neben dem Server, und ein Neustart verliert nichts.

```console
$ blunderbase analyze --tier deep --limit 50
$ blunderbase analyze --fen "rn1qkb1r/..." --nodes 4000000
```

| Flag | Standard | Wirkung |
|---|---|---|
| `--game-id N` | jede ausstehende Partie | Eine einzelne Partie analysieren |
| `--tier` | `quick` | `quick` oder `deep` |
| `--fen` | — | Eine Stellung analysieren statt einer Partie |
| `--ply-range START:END` | die ganze Partie | Die Halbzüge, die eine Tiefenanalyse ansehen soll, Ende exklusiv |
| `--multipv N` | die gespeicherte Einstellung | Wie viele Varianten behalten werden |
| `--nodes N` | die gespeicherte Einstellung | Das Budget je Stellung |
| `--limit N` | — | Höchstens N Partien einreihen |
| `--queue-only` | aus | Einreihen, ohne die Worker laufen zu lassen |
| `--timeout` | `3600` | Nach so vielen Sekunden das Warten aufgeben |

## mcp { #mcp }

Betreibt den MCP-Server für sich allein. `serve` bindet `/mcp` schon ein, das hier ist also
für einen lokalen Client, der einen eigenen Prozess über stdio will.

```console
$ blunderbase mcp
$ blunderbase mcp --transport http
```

| Flag | Standard | Wirkung |
|---|---|---|
| `--transport` | `stdio` | `stdio` für einen lokalen Client; `http` braucht `BLUNDERBASE_MCP_BEARER_KEY` |
| `--host` | `BLUNDERBASE_HOST` | Die Adresse, an die gebunden wird, für `http` |
| `--port` | `BLUNDERBASE_PORT` plus eins | Der Port, an den gebunden wird, für `http` |

Siehe [Dein KI-Assistent](../guide/coach.md).

## set-password { #set-password }

Setzt oder ersetzt das Passwort des Besitzers, das zugleich als MCP-Bearer-Token akzeptiert
wird. Wird zweimal abgefragt und nie angezeigt.

```console
$ blunderbase set-password
```

## db { #db }

Datenbankpflege. Sichern und Wiederherstellen steht unter
[Sichern und wiederherstellen](backup.md).

```console
$ blunderbase db upgrade
$ blunderbase db backup /safe/place/blunderbase-2026-09-01.db
$ blunderbase db restore /safe/place/blunderbase-2026-09-01.db --force
```

| Befehl | Wirkung |
|---|---|
| `blunderbase db upgrade` | Ausstehende Migrationen anwenden. Auch beim Zurückgehen auf eine ältere Version sicher, und auf dem aktuellen Stand passiert nichts |
| `blunderbase db backup <output>` | Eine auf Integrität geprüfte Kopie der vollständigen Datenbank schreiben. `--force` ersetzt eine vorhandene Ausgabedatei |
| `blunderbase db restore <input>` | Die Datenbank durch eine auf Integrität geprüfte Sicherung ersetzen. `--force` ist Pflicht, um eine vorhandene Datenbank zu ersetzen |
| `blunderbase db rebuild-cards` | Die gespeicherte Karte jeder analysierten Partie neu berechnen |
| `blunderbase db rebuild-stats` | Die gespeicherte Statistik-Zusammenfassung jeder analysierten Partie neu berechnen |
| `blunderbase db rebuild-book` | Das vorberechnete Eröffnungsbuch des Explorers über alle Stellungen neu berechnen |

Die drei `rebuild`-Befehle sind nie nötig. Ein fertiger Analysedurchlauf schreibt neu, was er
angefasst hat, und was fehlt, wird beim Herausgeben auf dem langsamen Weg berechnet. `serve`
lässt den Durchlauf für Statistiken und Buch beim Start im Hintergrund laufen; die Befehle
sind also dafür, es jetzt zu tun und dabei zuzusehen – nach dem Import eines großen Archivs
oder bei einer Bibliothek, die analysiert wurde, bevor es diese Spalten gab.

## demo { #demo }

Baut eine anonyme Datenbank, die schreibgeschützt ausgeliefert wird. Siehe
[Eine schreibgeschützte öffentliche Demo](deploy.md#a-read-only-public-demo).

```console
$ blunderbase demo create --games 3000
```

`blunderbase demo create` liest eine bunt gemischte Auswahl analysierter Partien aus der
konfigurierten Bibliothek und schreibt eine eigene Datenbank. Es baut den PGN-Text ohne
Kommentare neu auf und erfindet jede Angabe, an der jemand zu erkennen wäre; Zugangsdaten und
persönliche Notizen werden nie kopiert. Jede Partie kommt mit einer fertigen Schnellanalyse
an, und das Ergebnis trägt keine Engine-Zeile, auf der Maschine, die es ausliefert, muss also
nie etwas rechnen.

| Flag | Standard | Wirkung |
|---|---|---|
| `--from` | `BLUNDERBASE_DB_PATH` | Die Quellbibliothek |
| `--output` | `<data dir>/demo.db` | Die neue Demo-Datenbank |
| `--games N` | `3000` | Wie viele Partien genommen werden |
| `--as-of YYYY-MM-DD` | heute | Das Datum der neuesten erfundenen Partie |
| `--force` | aus | Eine vorhandene Ausgabedatenbank ersetzen |
| `--runners` | aus | Die Runner-Zeilen kopieren – Name, Slots und den Hash des Tokens, sonst nichts –, damit ein Runner, der sich bei der Quellbibliothek anmeldet, sich mit demselben Token bei der Demo anmeldet |

## blunderbase-runner { #blunderbase-runner }

Betreibt auf dieser Maschine Schach-Engines für einen Blunderbase-Server. Die
Konfigurationsdatei und jeder Schlüssel darin stehen unter [Remote Runner](runners.md).

```console
$ blunderbase-runner --config runner.yaml --check
$ blunderbase-runner --config runner.yaml
```

| Flag | Wirkung |
|---|---|
| `--version` | Die Version ausgeben und beenden |
| `--config PATH` | Die `runner.yaml`, die gelesen wird. Voreingestellt `BLUNDERBASE_RUNNER_CONFIG`, und sonst allein die Umgebung |
| `--check` | Jede Engine prüfen, eine Verbindung öffnen, ausgeben, was akzeptiert wurde, und beenden. Nicht auf einen Timer legen: es übernimmt einen laufenden Runner |
| `--log-level` | `debug`, `info`, `warning` oder `error`. Überschreibt `log_level` in der Datei |

Exit-Codes: `0` wie gewünscht gestoppt, `1` die Konfiguration ist falsch oder es ließ sich
keine Engine starten, `2` der Server hat die Protokollversion dieses Runners abgelehnt.
