# Bibliothek

Zwei Seiten: **Importieren**, wo Partien hereinkommen, und **Verwalten**, wo sie
herauskommen oder verschwinden.

## Importieren { #import }

Die Seite besteht aus drei Bereichen, von oben nach unten: **Konten**, aus denen
synchronisierte Partien kommen, **PGN-Datei** und die **Synchronisierungs-Historie** von
beiden.

### Ein Konto verbinden { #connect-an-account }

Unter **Konten** gibt es je ein Feld für Lichess, Chess.com und FICS. Oben steht der Name der
Seite und, sobald das Konto verbunden ist, wie viele Partien von dort kamen.
Benutzername eintragen, **Verbinden**
drücken, dann **Synchronisieren**. Dieselbe Schaltfläche synchronisiert später erneut und
macht dort weiter, wo der letzte abgeschlossene Lauf aufgehört hat. Jeder Import prüft auf
Duplikate, ein zweiter Durchlauf über dasselbe Archiv speichert also nichts doppelt.

Kennt die Seite den Namen nicht, schlägt die Synchronisierung fehl und es wird nichts
verbunden; ein Tippfehler lässt sich also einfach korrigieren und neu verbinden. FICS kann
einen unbekannten Namen nicht von einem Spieler ohne Partien unterscheiden, dort gilt das
Konto erst mit der ersten gefundenen Partie als verbunden. Eine Lichess-Partie, die noch
läuft, etwa eine Fernpartie, bleibt draußen, bis sie beendet ist; die erste
Synchronisierung danach holt sie herein, egal wie lange sie gedauert hat. Fernpartien, die
schon vor dieser Version zu Ende gingen und nie angekommen sind, holt eine einzige
Synchronisierung **Von Anfang an** nach.

### Optionen für die Synchronisierung { #sync-options }

Die Kopfzeile von **Konten**, über den Feldern, gilt für alle Konten:

| Option | Wirkung |
|---|---|
| **Seit** | Nur Partien ab diesem Datum |
| **Max. Partien** | Nach so vielen Partien aufhören; leer heißt alle |
| **Von Anfang an** | Den gemerkten Stand ignorieren und das ganze Archiv lesen |
| **Bewertung überspringen** | Partien nur speichern, keine Analyse einreihen |

Für eine PGN-Datei gilt nichts davon; ihr Bereich hat ein eigenes **Bewertung
überspringen**.

### Alle synchronisieren { #sync-all }

**Alle synchronisieren** am Ende der Kopfzeile drückt bei jedem verbundenen Konto, in dessen
Feld **Mit synchronisieren** angehakt ist, auf **Synchronisieren**, mit dem, was in der
Kopfzeile steht. Synchronisiert wird das Konto, das im jeweiligen Feld steht; einen neuen
Benutzernamen verbindest du mit **Verbinden** in seinem eigenen Feld. Ist die Schaltfläche
ausgegraut, verrät sie beim Darüberfahren den Grund: Noch ist nichts verbunden, alle Konten
sind ausgenommen, oder es läuft schon eine Synchronisierung.

### Automatisch synchronisieren { #sync-automatically }

**Automatisch synchronisieren**, der Schalter am Fuß von **Konten**, drückt für dich alle
paar Minuten bei jedem verbundenen Konto auf **Synchronisieren**, ein Konto nach dem anderen.
Schalte ihn ein und trag die Minuten ins Feld daneben ein. Das Feld zeigt das tatsächlich
gültige Intervall; es kann aufgerundet sein. Ausgeschaltet behält es die letzte Zahl,
ausgegraut.

### Lichess-Partien live importieren { #import-lichess-games-live }

Unter dem Lichess-Feld steht **Mit Lichess verbinden**. Die Schaltfläche führt dich zu
lichess.org, wo du Blunderbase den Zugriff erlaubst, und wieder zurück. Danach steht im Feld
**Verbunden als** mit deinem Lichess-Namen, und eine Partie, die du dort beendest, taucht
wenige Sekunden später in Blunderbase auf, die Analyse schon eingereiht, als hättest du
selbst **Synchronisieren** gedrückt. Dieselbe Verbindung brauchen auch die
[Referenzdatenbanken](explorer.md#connect-lichess).

Das klappt nur für das Lichess-Konto, mit dem du dich angemeldet hast. Dieses Konto muss
einmal ganz normal synchronisiert worden sein, und in seinem Feld muss **Mit
synchronisieren** angehakt sein; die Zeile unter **Verbunden als** sagt dir, was davon
fehlt. **Automatisch synchronisieren** läuft daneben weiter und holt Partien nach, die zu
Ende gingen, während die Verbindung unterbrochen war. **Trennen** entfernt die Verbindung aus
Blunderbase und widerruft sie bei Lichess.

In der Desktop-App erlaubst du den Zugriff in deinem gewohnten Browser, wo du bei Lichess
meist schon angemeldet bist. Den Tab kannst du danach schließen, die App aktualisiert sich
von selbst. Erreichst du Blunderbase über einfaches `http` unter einer anderen Adresse als
`localhost`, zeigt Lichess auf der Freigabeseite „Does not use a secure connection“. Es
funktioniert trotzdem. Chess.com und FICS melden nicht, wann eine Partie endet, dort bleibt
es beim Synchronisieren.

### Eine Synchronisierung stoppen { #stop-a-sync }

Ein laufender Import zeigt seine Zähler in seinem Feld, daneben steht **Stoppen**. Er hält
nach der gerade verarbeiteten Partie an. Was angekommen ist, bleibt, die Historie vermerkt
**Gestoppt**, und **Synchronisieren** macht später an dieser Stelle weiter.

### Eine PGN-Datei importieren { #import-a-pgn-file }

Drück unter **PGN-Datei** auf **Datei wählen …** oder zieh eine Datei auf diesen Bereich oder
irgendwo ins Fenster; mehrere auf einmal werden wie eine Datei gelesen. Gib an, ob es
**Meine** oder **Nicht meine** Partien sind, hak **Bewertung überspringen** an, wenn die
Partien nur gespeichert werden sollen, und drück **Hochladen**. Solange keine Datei gewählt
ist, bleibt **Hochladen** ausgegraut. Fremde Partien werden analysiert und sind durchsuchbar
wie alle anderen, zählen aber in keiner Statistik. Landet eine Datei anderswo im Fenster,
stellt ein kleiner Dialog dieselbe Frage, bevor importiert wird.

Ob die Datei in UTF-8 vorliegt oder in Latin-1 bzw. Windows-1252, wie ChessBase und viele
ältere Programme sie schreiben, erkennt Blunderbase für jede Datei selbst. Namen mit
Umlauten und Akzenten wie „Müller“ kommen so an, wie sie in der Datei stehen.

### Fernschachpartien { #correspondence-games }

Eine Partie, die du noch spielst, wird nicht hier importiert. Du legst sie unter
[Fernschach](correspondence.md) an. Sie wird mit der Quelle **ICCF** gespeichert, wenn du
eine ICCF-Partienummer angibst, und als manuelle Partie, wenn nicht.

Sie gehört ab dem Tag zur Bibliothek, an dem du sie anlegst, nicht erst ab dem Abschluss:
Sie steht sofort unter **Partien**, noch ohne Züge und ohne Ergebnis, die
Synchronisierungs-Historie darunter führt sie als Lauf mit einer Partie unter ihrer Quelle,
und sie wächst Zug um Zug mit dem, was du einträgst. Solange sie läuft, wird sie nicht
analysiert – ihr Baum ist der Ort, an dem die Arbeit der Engines liegt –, und beim
Abschließen wird der übliche Analysedurchlauf eingereiht. Danach liest sie
sich wie jede andere Partie.

### Die Synchronisierungs-Historie { #read-the-sync-history }

Jeder Lauf, neueste zuerst: Quelle, Startzeit, Dauer, wie viele Partien er gesehen,
importiert, übersprungen, als früher gelöscht abgewiesen oder nicht verarbeiten konnte, und
sein Stand als farbiger Punkt mit einem Wort (**Fertig**, **Fehlgeschlagen**, **Gestoppt**).
Vor einem Lauf, der Partien verloren hat, steht ein Pfeil: **Fehlschläge anzeigen** klappt
unter der Zeile auf, welche Partien er nicht speichern konnte. Ab 25 Läufen blättern die
Pfeile am Fuß der Liste weiter.

## Verwalten { #manage }

### Als PGN exportieren { #export-a-portable-pgn }

**PGN exportieren** lädt alle Partien herunter, mit Notizen als Kommentaren und
gespeicherten Varianten als Varianten, für ein anderes Schachprogramm. Engine-Analysen und
Einstellungen sind nicht Teil eines PGN.

### Eine Datenbanksicherung herunterladen { #download-a-database-backup }

**Sicherung herunterladen** erstellt eine konsistente Kopie der SQLite-Datei, mit Analysen,
Konten und Einstellungen, sobald der Server den Schnappschuss vorbereitet hat. Die
geschätzte Größe steht vor dem Klick dabei. Zum Wiederherstellen brauchst du die
Kommandozeile bei gestopptem Blunderbase: siehe
[Backup and restore](../operate/backup.md).

### Die importierte Bibliothek zurücksetzen { #reset-the-imported-library }

**Importierte Bibliothek zurücksetzen …**, die rot umrandete Schaltfläche, löscht jede
Partie samt Analyse, Partie-Notizen und Synchronisierungs-Historie. Konten, Engines und
reine Stellungsnotizen bleiben. Vorher kommt eine Rückfrage, auf einem Server mit deinem
Passwort, und erst **Partien löschen** in diesem Dialog löscht wirklich. Es gibt kein Rückgängig.

### Gelöschte Partien { #deleted-games }

**Gelöschte Partien** ist die Liste dessen, was ein Import nicht noch einmal speichern
darf. Ohne sie würde die nächste Synchronisierung eine gelöschte Partie als neu wieder
hereinholen. **Vergessen** an einer Zeile oder **Alle vergessen** erlaubt dem nächsten
Import, die Partie wieder zu speichern, allerdings ohne die Analysen und Notizen, die das
Original hatte. Es holt keine Partie zurück; deshalb heißt die Schaltfläche nicht
„Wiederherstellen“. Solange nichts gelöscht wurde, fehlt die Karte.
