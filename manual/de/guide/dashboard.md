# Übersicht

Der erste Bildschirm: was in der Bibliothek liegt, was zuletzt schiefgegangen ist und was
die Engines gerade tun. Die Zeile unter dem Titel zählt deine Partien und die groben Patzer,
die sich noch niemand angesehen hat.

## Alle Konten synchronisieren

**Alle synchronisieren** holt bei jedem verbundenen Konto die neuen Partien, eines nach dem
anderen. Ist noch kein Konto verbunden, heißt die Schaltfläche **Konto verbinden**, und
**PGN importieren** daneben führt zur selben Seite für eine Datei. Beides ist
[Bibliothek](library.md#import).

## Wertungsverläufe

Ein Diagramm je Bedenkzeit, darin eine Linie je Plattform, sodass Lichess-Blitz und
Chess.com-Blitz dieselben Achsen teilen. **Bedenkzeiten** blendet die aus, die du nicht
spielst; die Zeitraum-Auswahl schneidet alle Diagramme am selben Punkt ab. Gezeichnet werden
nur gewertete Partien.

## Schlimmste Momente

Die groben Patzer der letzten dreißig Tage, jeder als die Stellung, aus der er gespielt
wurde: dein Zug in Rot, der von der Engine bevorzugte in Türkis. Ein Klick auf eine Kachel
öffnet die Partie an diesem Zug. Ist die Reihe leer, ist in den analysierten Partien noch
nichts wirklich schiefgegangen.

## Neueste Partien

Die letzten zwölf importierten Partien, neueste zuerst. Fahr mit der Maus über eine Zeile,
um Eröffnung, Quelle und den Stand der Analyse zu sehen. **Alle Partien** öffnet
[Partien](games.md).

## Die Analyse-Warteschlange

Wie viel wartet und wie viel gerade läuft. Jeder Durchlauf erscheint, sobald er startet, und
neben einem fehlgeschlagenen steht **wiederholen**. Steht dort, dass die Warteschlange nicht
abgearbeitet wird, nimmt sich kein Worker die Durchläufe vor – siehe
[Analyse](analysis.md).

## Trends

Grobe Patzer je Partie, der Gewinnprozent-Verlust eines durchschnittlichen Zugs und deine
Punkteausbeute, jeweils verglichen mit dem gleich langen Zeitraum davor. Die Zeitraum-Auswahl
verschiebt beide Hälften.
