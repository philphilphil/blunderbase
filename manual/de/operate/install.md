# Installieren

Blunderbase ist ein Prozess auf einem Port. Alles – die Seite, die API, das Event-Socket
und der MCP-Endpunkt – kommt aus derselben Origin. Eine Installation ist deshalb ein
einzelner Container oder eine einzelne Anwendung.

Nimm eines von dreien:

| Du willst | Nimm |
|---|---|
| Einen Server, den du und deine anderen Geräte über das Netzwerk erreichen | [Docker](#docker) |
| Einen Rechner, ohne Terminal, ohne Container | [Die Desktop-Anwendung](#the-desktop-application) |
| Dasselbe auf einem Rechner, auf dem du entwickelst | [Docker](#docker), oder ein Start aus einem Quellcode-Checkout |

## Docker { #docker }

Das Image ist `ghcr.io/philphilphil/blunderbase:latest`. Stockfish ist enthalten, eine
frische Installation kann also analysieren, ohne dass sonst etwas installiert wird.

```bash
# Eine Beispiel-Compose-Datei: ein Service, ein Volume.
curl -O https://blunderbase.org/docker-compose.yml
docker compose up -d
```

Ohne Compose:

```bash
docker run -d --name blunderbase -p 8765:8765 \
  -v blunderbase-data:/data \
  ghcr.io/philphilphil/blunderbase:latest
```

| Ding | Wert |
|---|---|
| Port | `8765` im Container |
| Volume | `/data` – die Datenbank, hochgeladene PGN-Dateien und jede aus der App heruntergeladene Engine |
| Datenbank | `/data/blunderbase.db` |
| Start | Der Container migriert die Datenbank und bedient dann `0.0.0.0:8765` |

Auf einem Rechner, den andere Leute erreichen können, veröffentliche den Port nur auf
Loopback (`"127.0.0.1:8765:8765"`) und setz TLS davor. Siehe
[Hinter einem Proxy](deploy.md).

Die Compose-Datei oben ist ein Beispiel. Jede Einstellung, die sie tragen kann, steht unter
[Konfiguration](configuration.md).

## Die Desktop-Anwendung { #the-desktop-application }

Die Installer für macOS und Windows liegen auf der
[Seite des letzten Release](https://github.com/philphilphil/blunderbase/releases/latest).
Jede Datei trägt ihre Version im Namen: `Blunderbase-<version>-macOS-arm64.dmg` und
`Blunderbase-<version>-Windows-x64-setup.exe`.

Die Anwendung bringt die Web-App und das Backend mit. Sie braucht kein Python, keinen
Container und kein Terminal und läuft vollständig auf diesem Rechner.

| Plattform | Hinweise |
|---|---|
| macOS | Apple Silicon. Der Build ist nicht signiert, erlaub ihn also beim ersten Start in den Systemeinstellungen |
| Windows | x64, ein NSIS-Installer. Nicht signiert, Windows zeigt also einen SmartScreen-Hinweis |

Wo die Bibliothek liegt:

| Plattform | Pfad |
|---|---|
| macOS | `~/Library/Application Support/app.blunderbase.desktop/blunderbase.db` |
| Windows | `%APPDATA%\app.blunderbase.desktop\blunderbase.db` |

`desktop.log` liegt neben der Datenbank und ist die erste Stelle zum Nachsehen, wenn das
Fenster leer aufgeht.

Die Desktop-Anwendung bringt keine Engine-Binärdatei mit. Zeig ihr ein Stockfish, das schon
auf dem Rechner liegt, nutz den WebAssembly-Build des Browsers oder häng einen
[Remote Runner](runners.md) an. Siehe [Engines](engines.md).

Sie hat auch keinen MCP-Endpunkt. [Deinen KI-Assistenten](../guide/coach.md) anzuschließen
braucht deshalb eine Server- oder Docker-Installation.

## Der erste Start { #first-run }

Öffne die Adresse, unter der die Installation läuft – bei einer voreingestellten
Docker-Installation `http://localhost:8765`; die Desktop-Anwendung öffnet ihr eigenes
Fenster.

**Wer eine frische Installation als Erster öffnet, wählt das Passwort.** Bis eines gewählt
ist, zeigt die App den Einrichtungsbildschirm statt der Anmeldung, und jeder API-Aufruf
antwortet `401 setup_required`. Es gibt keine Registrierung und kein zweites Konto: ein
Besitzer, ein Passwort.

Das Passwort muss mindestens acht Zeichen haben. Es ist auch das Bearer-Token, das `/mcp`
akzeptiert, solange du keine Schlüssel erzeugt hast – wähl es entsprechend.

Arbeite dann [Erste Schritte](../guide/getting-started.md) durch: ein Konto verbinden,
importieren, eine Engine registrieren.

Eine frische Installation zeigt beim ersten Öffnen eine kurze geführte Tour.
**Tour erneut anzeigen** im Kontomenü holt sie zurück.

Das Passwort ohne Browser setzen oder zurücksetzen:

```bash
blunderbase set-password
```

Der Befehl fragt zweimal und zeigt die Eingabe nie an. Unter Docker stell
`docker exec -it blunderbase` davor.

## Anmelden und Sitzungen { #signing-in-and-sessions }

Beim Anmelden wird ein HTTP-only-Cookie `blunderbase_session` gesetzt, das über 30 Tage
gleitet: jede Anfrage schiebt den Ablauf wieder nach hinten. Das Cookie trägt `Secure` auf
jedem Host, der nicht Loopback ist. Eine Installation, die über einfaches HTTP unter einem
Namen erreicht wird, hält dich deshalb nicht angemeldet – setz TLS davor.

Fünf falsche Passwörter hintereinander sperren die Tür für ein paar Sekunden, und jeder
weitere Fehlversuch verdoppelt das bis auf fünf Minuten.

Gespeichert werden nur Hashes, vom Passwort wie von den Sitzungs-Token. Eine Kopie der
Datenbank ist also kein Weg hinein.

Die Desktop-Anwendung authentifiziert ihr eigenes Fenster mit einem Token je Start und
fragt nie nach einem Passwort.

## Das Passwort ändern { #changing-the-password }

Kontomenü → **Passwort ändern**. Gefragt wird nach dem aktuellen und zweimal nach dem
neuen.

Eine Passwortänderung meldet jeden anderen Browser ab und macht das Passwort als
MCP-Bearer-Token ungültig. Erzeugte Schlüssel funktionieren weiter.

## Wie sich ein MCP-Client authentifiziert { #how-an-mcp-client-authenticates }

`/mcp` akzeptiert, in dieser Reihenfolge:

1. `BLUNDERBASE_MCP_BEARER_KEY`, wenn die Installation es setzt – ein zusätzlich
   akzeptiertes Token, für Automatisierung und Compose-Dateien.
2. Einen Schlüssel, den du auf der Seite **Assistent** erzeugt hast.
3. Das Passwort des Besitzers.

Ein im Browser gewähltes Passwort funktioniert an `/mcp` also sofort, ohne Neustart.

Sobald mehr als ein Client hinein will, erzeug unter **Assistent** je Client einen
Schlüssel. Schlüssel sehen aus wie `bb_mcp_…`, werden als SHA-256-Hash gespeichert, genau
einmal angezeigt und einzeln widerrufen – einen zu löschen meldet diesen Client ab und
sonst nichts. Die Liste zeigt, wann jeder Schlüssel zuletzt benutzt wurde.

Passwortraten an `/mcp` hat ein eigenes Limit von zehn Versuchen pro Minute. Es kostet
deine Browser-Anmeldung deshalb nie ihre Sperre, und ein erzeugter Schlüssel wird nie durch
fremde Rateversuche gebremst.

Einen Client anzuschließen steht unter [Dein KI-Assistent](../guide/coach.md).

## Aktualisieren { #upgrading }

Docker:

```bash
docker compose pull
docker compose up -d
```

Der Container wendet beim Start ausstehende Migrationen an, und ein Schemafehler ist der
Exit-Code des Containers statt ein Stacktrace in einem laufenden Prozess. Mach vorher eine
[Sicherung](backup.md), wenn die Release-Notes eine erwähnen.

Desktop: lad den neueren Installer von der Release-Seite und installier ihn über den alten.
Die Bibliothek bleibt, wo sie ist.

Releases und ihre Notizen stehen unter
[github.com/philphilphil/blunderbase/releases](https://github.com/philphilphil/blunderbase/releases).
