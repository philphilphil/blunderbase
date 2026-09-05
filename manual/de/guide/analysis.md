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
