# Analyse

## Warum zwei Engines?

|  | Stockfish | Maia |
|---|---|---|
| fragt | was der beste Zug ist | was ein Mensch auf den gewählten Spielstärken ziehen würde |
| rechnet | das Knotenbudget, das du je Stufe festlegst (voreingestellt 250k schnell, 2M tief) | ein Blick, keine Suche |
| liefert | eine Variante nach der Schnellanalyse; nach der Tiefenanalyse so viele, wie du behältst (voreingestellt 4) | fünf Züge je Spielstärke, jeder mit Wahrscheinlichkeit |
| Varianten? | ja | nie |

Jede Zahl in dieser Tabelle ist eine Einstellung: Budgets und Variantenzahl unter **Analyse
→ Engine-Durchläufe**, die Spielstärken unter **Analyse → Maia**.

## Schnell oder tief?

Die Schnellanalyse läuft beim Import automatisch. Die Tiefenanalyse startest du selbst, und
sie wird in der Warteschlange vorgezogen. Du reihst sie aus einer Partie mit `Q` und `D`
ein oder über ausgewählte Zeilen unter **Partien**. Hat eine Partie eine Tiefenanalyse, wird
sie daraus gelesen und nicht mehr aus der Schnellanalyse.

## Was hat ein Zug gekostet?

Gewinnprozent vor dem Zug minus Gewinnprozent danach. Die voreingestellten Schwellen:

| Verlust | Markierung |
|---|---|
| 5 | `?!` Ungenauigkeit |
| 10 | `?` Fehler |
| 15 | `??` grober Patzer |

## Was ist noch zu analysieren? { #what-is-left-to-analyse }

**Analyse → Abdeckung** zeigt, wie viel der Bibliothek eine Engine schon gesehen hat und was
der Rest kosten würde. **Schnellanalyse nachtragen** und **Tiefenanalyse nachtragen** reihen
den Rest ein; Partien, die diese Stufe schon haben, werden übersprungen. **Fehlende Stufen
nachtragen** tut dasselbe für Maia. **Warteschlange leeren** leert sie, und
**Fehlgeschlagene Durchläufe** listet auf, was du wiederholen kannst.

## Wie viel rechnet ein Durchlauf? { #how-much-work-does-a-pass-do }

**Analyse → Engine-Durchläufe** legt das Knotenbudget jeder Stufe fest, wie viele Varianten
eine Tiefenanalyse behält und die drei Schwellen von oben.

## Was wird Maia gefragt? { #what-is-maia-asked }

**Analyse → Maia** legt fest, welche Spielstärken gefragt werden – bis zu fünf Wertungen
zwischen 1100 und 2000, eine frische Installation fragt nur 2000 –, ob Maia bei
Schnellanalysen, Tiefenanalysen oder beiden mitläuft, und **Nach beiden Seiten fragen**:
aus betrachtet nur deine Züge, an sagt auch die des Gegners voraus. Eine Variante liefert
Maia nie: ein Blick ohne Suche ergibt eine Verteilung von Zügen, keine Fortsetzung. Ein
*Nachtrag* ergänzt fehlende Spielstärken bei einer Partie, die schon eine Bewertung hat.

## Fernschach { #correspondence }

**Analyse → Fernschach** schaltet den Fernschachmodus ein, hält die Zahlen, mit denen eine
neue Partie und eine neue Suche starten, und legt fest, welche Engines auf eine Stellung
angesetzt werden dürfen. Ist er aus – die Voreinstellung –, gibt es **Fernschach**
nicht in der Seitenleiste, und seine Seiten schicken dich zur Übersicht zurück.

| Einstellung | |
|---|---|
| **Fernschachmodus** | An ergänzt den Eintrag in der Seitenleiste unter **Live** |
| **Linien pro Suche** | Wie viele Kandidatenvarianten eine Engine behält, wenn sie auf eine Stellung eines Fernschachbaums angesetzt wird, 1 bis 5, voreingestellt drei |
| **Suchplätze** | Wie viele Suchen dieser Rechner gleichzeitig laufen lässt, 1 bis 16, voreingestellt zwei – eine CPU-Engine und eine GPU-Engine ist das übliche Paar. Suchen haben eigene Plätze: eine Suche, die tagelang läuft, nimmt also nie den Platz weg, auf den die Schnellanalyse einer importierten Partie wartet. Der Wert wird beim Start des Servers gelesen: **ändern und neu starten** |
| **Knoten pro Aufgabe** | Was eine Aufgabe kostet, voreingestellt vierzig Millionen: ein bis zwei Minuten einer modernen Engine – gerade so, dass eine Erweiterung über ein Dutzend Stellungen fertig wird, während du noch aufs Brett schaust. Der Wert wird beim Einreihen auf die Aufgabe kopiert; änderst du ihn, gilt er für die nächste |
| **Linien pro Aufgabe** | Wie viele Kandidatenvarianten eine Aufgabe behält, 1 bis 5, voreingestellt drei – und damit, wie breit eine Erweiterung sein kann, denn die Kinder entstehen aus diesen Varianten |
| **Veraltet unter Tiefe** | Unter dieser Tiefe wird ein gespeichertes Urteil im Baum als veraltet markiert, 1 bis 100, voreingestellt dreißig. Die andere Hälfte braucht keine Zahl: Ein Urteil von einer Version der Engine, die nicht mehr installiert ist, ist veraltet, wie tief es auch ging |

Eine Engine-Einstellung gibt es nicht: Welche Engine sucht oder eine Aufgabe abarbeitet,
wählst du an der Stellung, im Dialog, aus allen eingeschalteten Engines – siehe
[Eine Stellung rechnen lassen](correspondence.md#search-a-position). Vorgeschlagen wird die
Engine mit der Rolle **Tiefenanalyse**.

Ein leeres Feld heißt: die Voreinstellung gilt. Was der Modus selbst tut, steht unter
[Fernschach](correspondence.md); wie du ihm eine eigene Engine gibst, unter
[Engines](../operate/engines.md).
