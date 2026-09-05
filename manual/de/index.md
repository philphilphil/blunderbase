# Blunderbase

Blunderbase ist eine persönliche Schachdatenbank. Sie importiert deine Partien von Lichess,
Chess.com, FICS und aus PGN-Dateien, lässt Stockfish über jede neue Partie laufen und fragt
auf Wunsch Maia, was ein Mensch deiner Spielstärke stattdessen gezogen hätte. Alles liegt
in einer einzigen SQLite-Datei, die dir gehört: Partien, Analysen, Notizen, gespeicherte
Varianten und Statistiken.

Auf dieselbe Bibliothek gibt es drei Zugänge. Die Web-App mit Brett, Partienliste, Explorer
und Statistiken. Der MCP-Server: Blunderbase enthält keine eigene KI, aber der Assistent,
den du ohnehin in deinem Editor oder Chat-Client benutzt, kann über MCP dieselben Daten lesen
und aus deinen Partien antworten statt aus Allgemeinplätzen. Und die Kommandozeile. Das
Ganze ist ein Prozess auf einem Port, deshalb ist eine Installation ein einzelner Container,
eine Desktop-Anwendung oder ein einzelner Befehl.

## Anleitung

Für den täglichen Gebrauch. Ein Kapitel je Eintrag in der Seitenleiste der App, in derselben
Reihenfolge.

- [Erste Schritte](guide/getting-started.md) – die erste Stunde: anmelden, Engines
  einrichten, Partien importieren.
- [Übersicht](guide/dashboard.md) – Wertungsverläufe, die schlimmsten Momente, neueste
  Partien, die Analyse-Warteschlange, Trends.
- [Partien](guide/games.md) – filtern, suchen, Filter speichern, sortieren und blättern,
  mehrere Partien auf einmal bearbeiten, löschen.
- [Eine Partie analysieren](guide/game.md) – Brett, Bewertungsverlauf, Engine-Varianten, eigene
  Varianten, Zugbewertungen.
- [Explorer](guide/explorer.md) – dein eigener Eröffnungsbaum, die Lichess-Datenbanken,
  Musterpartien, das Repertoire.
- [Statistiken](guide/stats.md) – welche Berichte es gibt, welche Partien zählen, Zeitraum
  und Filter.
- [Notizen](guide/notes.md) – woran eine Notiz hängt, wo sie auftaucht, die Notizseite.
- [Live](guide/live.md) – das Brett, das ein MCP-Client steuert.
- [Bibliothek](guide/library.md) – Import von Lichess, Chess.com, FICS und PGN, automatische
  Synchronisierung, Export, Sicherung, Zurücksetzen.
- [Analyse](guide/analysis.md) – Schnell- und Tiefenanalyse, Maia, Abdeckung, Budgets, was
  als grober Patzer gilt.
- Engines ist der nächste Eintrag in der Seitenleiste; beschrieben ist er unter Betrieb in
  [Engines](operate/engines.md).
- [Dein KI-Assistent](guide/coach.md) – einen MCP-Client verbinden und was er kann.
- [Einstellungen](guide/settings.md) – Sprache, Erscheinungsbild, Bretteinstellungen,
  Tastenkürzel, die Tour.

## Betrieb

Für alle, die die Installation betreiben.

- [Installieren](operate/install.md) – Docker, die Desktop-Anwendungen, der erste Start,
  Anmeldung.
- [Hinter einem Proxy](operate/deploy.md) – Reverse Proxy und TLS, die öffentliche URL, der
  schreibgeschützte Modus.
- [Engines](operate/engines.md) – Stockfish und Maia, die drei Rollen, Kapazität.
- [Remote Runner](operate/runners.md) – Engines auf einem anderen Rechner.
- [Konfiguration](operate/configuration.md) – alle Umgebungsvariablen.
- [Kommandozeile](operate/cli.md) – alle Befehle und Optionen.
- [Sichern und wiederherstellen](operate/backup.md) – PGN-Export, Datenbanksicherung,
  Wiederherstellung.

Blunderbase ist freie Software unter der AGPL-3.0-or-later. Quelltext, Beispiel-Compose-Dateien
und Issue-Tracker liegen auf
[github.com/philphilphil/blunderbase](https://github.com/philphilphil/blunderbase).
