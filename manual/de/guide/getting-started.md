# Erste Schritte

## Zum ersten Mal anmelden { #sign-in-for-the-first-time }

Eine frische Installation fragt zuerst nach einem Passwort. Es gibt genau einen Besitzer und
ein Passwort. Danach verlangt die Anmeldeseite nur noch dieses Passwort, und die Sitzung
bleibt im Browser erhalten, bis du dich abmeldest. Läuft noch nichts, fang bei
[Install](../operate/install.md) an.

## Dich zurechtfinden { #find-your-way-around }

Die Leiste am linken Rand ist die App selbst. Ganz oben stehen der Name – in der
öffentlichen Demo dazu ein Hinweis **Demo**, der zu blunderbase.org führt – und **Alles
durchsuchen**. Das öffnet die Befehlspalette, genau wie `⌘K` von überall. Darunter folgen die
Seiten und unter Sammlungen die Sammlungen, die du [angeheftet](collections.md) hast. Die eine Zeile mit der
hellgrauen Hinterlegung und blauer Schrift zeigt, wo du bist. Liegt die Seite in einem
Eintrag, etwa **Importieren** unter Bibliothek, bleibt der Eintrag darüber schlicht. Zeigst
du mit der Maus auf eine Zeile, wird nur ihre Schrift heller. `⌘1` bis `⌘6` öffnen die
ersten Seiten, und der Tooltip einer Zeile nennt ihre Taste. Der Knopf am Ende der Zeile
mit dem Namen klappt die Leiste zu Symbolen ein; eingeklappt wird das Logo unter der Maus
zu dem Knopf, der sie wieder aufklappt.

Unten in der Leiste stehen deine Engines, eine pro Zeile, jede mit einem Punkt: grün, wenn
sie eingeschaltet ist, grau, wenn nicht. Jede führt zu **Rechenleistung › Engines**. Ist
[Fernschach](correspondence.md) eingeschaltet und läuft eine Suche, zeigt eine Zeile
**Fernschach** darunter die belegten Plätze (`1/2`), und fährst du darüber, steht dort der
Rest. Zuletzt kommt **Einstellungen**, darüber öffnet sich das Einstellungsmenü nach oben,
daneben der Verbindungspunkt: grün, solange die App live ist, orange beim Verbinden, rot
ohne Verbindung.

Die Leiste oben gehört der Seite. Sie zeigt den Titel der Seite, davor die übergeordneten
Orte als Links (`Bibliothek › Importieren`). Rechts folgen die Knöpfe der Seite, dann die
Analyse-Warteschlange (`Leerlauf 0/0`, oder ein Kreisel und ein Balken, solange sie
arbeitet, mit **Pause** und **Leeren** daneben, solange es etwas anzuhalten oder zu leeren
gibt) und zuletzt der Schalter **Engine ausblenden**
([Die Engine ausblenden](settings.md#hide-the-engine)).
Auf dem Handy liegt die linke Leiste hinter dem ☰ und schiebt sich mit demselben Inhalt
herein. Eine Seite, die du aus einer Liste geöffnet hast, etwa eine Partie, zeigt statt
des ☰ ein `‹ Partien`, das dich zurückbringt. Die Knöpfe der Seite stehen dort in einer
eigenen Zeile unter der Leiste.

## Engines einrichten { #register-your-engines }

Öffne **Rechenleistung › Engines** und trag Stockfish ein, und Maia, wenn du wissen willst, was ein Mensch
gezogen hätte. Weise jeder Aufgabe eine Engine zu. Vorher wird nichts analysiert. Woher die
Programme kommen, steht unter [Engines](../operate/engines.md).

## Partien importieren { #import-games }

Öffne **Bibliothek › Importieren**, gib deinen Benutzernamen bei Lichess, Chess.com oder
FICS ein und drücke **Verbinden**. Oder zieh eine PGN-Datei irgendwo ins Fenster. Beides ist
in [Bibliothek](library.md#import) beschrieben.

## Was automatisch passiert { #what-happens-automatically }

Jede neue Partie landet in der Warteschlange für eine Analyse mit Stockfish. Die
Bewertungen füllen sich also nach einer Synchronisierung von selbst. Die
[Übersicht](dashboard.md) zeigt, was wartet und was gerade läuft.

## Wo du Hilfe findest { #where-to-find-help }

Beim ersten Öffnen läuft eine Tour in fünf Schritten; **Tour erneut anzeigen** im
Einstellungsmenü startet sie noch einmal. **Handbuch zu dieser Seite** im selben Menü
öffnet dieses Handbuch beim Kapitel zum aktuellen Bildschirm. Die Taste `?` oder
**Tastenkürzel** im Einstellungsmenü zeigt, welche Tasten dort gelten. Ganz unten im Menü
stehen die Version, ein Link zu dem, was sich darin geändert hat, und der Quelltext auf
GitHub.
