# Übersicht

Der erste Bildschirm: was in der Bibliothek liegt, was zuletzt schiefgegangen ist und was
die Engines gerade tun. Die Zeile unter dem Titel zählt deine Partien und die groben Patzer,
die sich noch niemand angesehen hat.

## Alle Konten synchronisieren { #sync-all-accounts }

**Alle synchronisieren** holt bei jedem verbundenen Konto die neuen Partien, eines nach dem
anderen. Ist noch kein Konto verbunden, heißt die Schaltfläche **Konto verbinden**, und
**PGN importieren** daneben führt zur selben Seite für eine Datei. Beides ist
[Bibliothek](library.md#import).

## Wertungsverläufe { #rating-charts }

Ein Diagramm je Bedenkzeit, zwei in einer Reihe, darin eine Linie je Plattform, sodass
Lichess-Blitz und Chess.com-Blitz dieselben Achsen teilen. **Bedenkzeiten** blendet die
aus, die du nicht spielst; die Zeitraum-Auswahl schneidet alle Diagramme am selben Punkt
ab. Gezeichnet werden nur gewertete Partien.

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
um Eröffnung, Quelle und den Stand der Analyse zu sehen. **Alle**, mit der Zahl deiner
Partien daneben, öffnet [Partien](games.md).

## Die Analyse-Warteschlange { #the-analysis-queue }

Wie viel wartet und wie viel gerade läuft. Jeder Durchlauf erscheint, sobald er startet, und
neben einem fehlgeschlagenen steht **wiederholen**. Steht dort, dass die Warteschlange nicht
abgearbeitet wird, nimmt sich kein Worker die Durchläufe vor – siehe
[Analyse](analysis.md).

## Trends { #trends }

Grobe Patzer je Partie, der Gewinnprozent-Verlust eines durchschnittlichen Zugs und deine
Punkteausbeute, jeweils verglichen mit dem gleich langen Zeitraum davor. Die Zeitraum-Auswahl
verschiebt beide Hälften.
