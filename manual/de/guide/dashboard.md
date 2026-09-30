# Übersicht

Der erste Bildschirm: was in der Bibliothek liegt, was zuletzt schiefgegangen ist und was
die Engines gerade tun. Wie jeder Bildschirm hat sie keine eigene Überschrift: Ihr Name,
**Übersicht**, steht in der Titelleiste, und ihre zwei Schaltflächen stehen rechts am Ende
dieser Leiste.

## Alle Konten synchronisieren { #sync-all-accounts }

**Alle synchronisieren**, die blaue Schaltfläche, holt bei jedem verbundenen Konto die neuen
Partien, eines nach dem anderen; fährst du mit der Maus darüber, steht da, welche Konten es
sind. Ist noch kein Konto verbunden, heißt sie **Konto verbinden**, und **PGN importieren**
daneben führt zur selben Seite für eine Datei. Beides ist [Bibliothek](library.md#import).

## Wertungsverläufe { #rating-charts }

Ein Diagramm je Bedenkzeit, zwei in einer Reihe, darin eine Linie je Plattform, sodass
Lichess-Blitz und Chess.com-Blitz dieselben Achsen teilen. Die Zeitraum-Auswahl (**Alle**,
**1J**, **90T**, **30T**) schneidet alle Diagramme am selben Punkt ab. Die Auswahl
**Bedenkzeit** daneben zeigt **Bedenkzeit: Alle**; ein Klick öffnet je Bedenkzeit ein
Kästchen, von Bullet bis Klassisch, jedes mit der Zahl deiner gewerteten Partien daneben,
und was du nicht spielst, hakst du ab. Danach nennt sie, was übrig ist
(**Bedenkzeit: Blitz, Schnellschach**). Die letzte lässt sich nicht abhaken, und das **×**
neben einer eingegrenzten Auswahl holt alle zurück. Dieser Browser merkt sich die Wahl.
Gezeichnet werden nur gewertete Partien.

## Schlimmste Momente { #worst-moments }

Die groben Patzer der letzten dreißig Tage, drei in einer Reihe (sechs auf einem sehr
breiten Bildschirm), jeder als die Stellung, aus der er gespielt wurde. Unter dem Brett
stehen dein Zug und was er gekostet hat, der von der Engine bevorzugte – als blauer Pfeil
eingezeichnet und hinter **Am besten:** genannt – mit der Phase der Partie, dazu Gegner und
Datum. Ein Klick auf eine Kachel öffnet die Partie an diesem Zug. Ist die Reihe leer, ist in
den analysierten Partien noch nichts wirklich schiefgegangen. Solange die Engine
ausgeblendet ist (`⇧E`), fehlt die Reihe.

## Neueste Partien { #recent-games }

Die letzten zwölf importierten Partien, neueste zuerst. Fahr mit der Maus über eine Zeile,
um Eröffnung, Quelle und den Stand der Analyse zu sehen. **Alle ›**, mit der Zahl deiner
Partien daneben, öffnet [Partien](games.md).

## Die Analyse-Warteschlange { #the-analysis-queue }

Wie viel wartet und wie viel gerade läuft. Jeder Durchlauf erscheint, sobald er startet, und
neben einem fehlgeschlagenen steht die Schaltfläche **wiederholen**. Der Punkt neben der
Überschrift sagt, wie es um die Warteschlange steht: grau, solange nichts zu tun ist, grün
und pulsierend, während etwas läuft, orange mit **Worker im Leerlauf**, wenn sich niemand die
Durchläufe vornimmt – siehe [Analyse](analysis.md). Ist nichts offen, führt **Wähle eine
Partie** zu den [Partien](games.md), wo du eine zum Analysieren findest.

## Trends { #trends }

Grobe Patzer je Partie, der Gewinnprozent-Verlust eines durchschnittlichen Zugs und deine
Punkteausbeute, jeweils verglichen mit dem gleich langen Zeitraum davor. Die Zeitraum-Auswahl
(**7T**, **30T**, **90T**) verschiebt beide Hälften.
