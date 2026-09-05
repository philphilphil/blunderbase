# Bibliothek

Zwei Seiten: **Importieren**, wo Partien hereinkommen, und **Verwalten**, wo sie
herauskommen oder verschwinden.

## Importieren { #import }

### Ein Konto verbinden { #connect-an-account }

Es gibt je ein Feld für Lichess, Chess.com und FICS. Benutzername eintragen, **Verbinden**
drücken, dann **Synchronisieren**. Dieselbe Schaltfläche synchronisiert später erneut und
macht dort weiter, wo der letzte abgeschlossene Lauf aufgehört hat. Jeder Import prüft auf
Duplikate, ein zweiter Durchlauf über dasselbe Archiv speichert also nichts doppelt.

### Optionen für die Synchronisierung

Die Leiste über den Feldern gilt für alle Quellen:

| Option | Wirkung |
|---|---|
| **Seit** | Nur Partien ab diesem Datum |
| **Max. Partien** | Nach so vielen Partien aufhören; leer heißt alle |
| **Von Anfang an** | Den gemerkten Stand ignorieren und das ganze Archiv lesen |
| **Bewertung überspringen** | Partien nur speichern, keine Analyse einreihen |

### Automatisch synchronisieren

**Automatisch synchronisieren** drückt für dich alle paar Minuten bei jedem verbundenen
Konto auf **Synchronisieren**, ein Konto nach dem anderen. Das Feld zeigt das tatsächlich
gültige Intervall; es kann aufgerundet sein.

### Eine Synchronisierung stoppen

Ein laufender Import zeigt seine Zähler in seinem Feld, daneben steht **Stoppen**. Er hält
nach der gerade verarbeiteten Partie an. Was angekommen ist, bleibt, die Historie vermerkt
**Gestoppt**, und **Synchronisieren** macht später an dieser Stelle weiter.

### Eine PGN-Datei importieren

Wähle im PGN-Feld eine Datei oder zieh eine irgendwo ins Fenster; mehrere auf einmal werden
wie eine Datei gelesen. Gib vorher an, ob es **Meine** oder **Nicht meine** Partien sind.
Fremde Partien werden analysiert und sind durchsuchbar wie alle anderen, zählen aber in
keiner Statistik.

### Die Synchronisierungs-Historie

Jeder Lauf, neueste zuerst: Quelle, Startzeit, Dauer und wie viele Partien er gesehen,
importiert, übersprungen, als früher gelöscht abgewiesen oder nicht verarbeiten konnte.
**Fehlschläge anzeigen** zeigt nur die Läufe, die schiefgegangen sind.

## Verwalten { #manage }

### Als PGN exportieren

**PGN exportieren** lädt alle Partien herunter, mit Notizen als Kommentaren und
gespeicherten Varianten als Varianten, für ein anderes Schachprogramm. Engine-Analysen und
Einstellungen sind nicht Teil eines PGN.

### Eine Datenbanksicherung herunterladen

**Sicherung herunterladen** erstellt eine konsistente Kopie der SQLite-Datei, mit Analysen,
Konten und Einstellungen, sobald der Server den Schnappschuss vorbereitet hat. Die
geschätzte Größe steht vor dem Klick dabei. Zum Wiederherstellen brauchst du die
Kommandozeile bei gestopptem Blunderbase: siehe
[Backup and restore](../operate/backup.md).

### Die importierte Bibliothek zurücksetzen

**Importierte Bibliothek zurücksetzen** löscht jede Partie samt Analyse, Partie-Notizen und
Synchronisierungs-Historie. Konten, Engines und reine Stellungsnotizen bleiben. Die Aktion
fragt nach deinem Passwort, und es gibt kein Rückgängig.

### Gelöschte Partien

**Gelöschte Partien** ist die Liste dessen, was ein Import nicht noch einmal speichern
darf. Ohne sie würde die nächste Synchronisierung eine gelöschte Partie als neu wieder
hereinholen. **Vergessen** an einer Zeile oder **Alle vergessen** erlaubt dem nächsten
Import, die Partie wieder zu speichern, allerdings ohne die Analysen und Notizen, die das
Original hatte. Es holt keine Partie zurück; deshalb heißt die Schaltfläche nicht
„Wiederherstellen“. Solange nichts gelöscht wurde, fehlt die Karte.
