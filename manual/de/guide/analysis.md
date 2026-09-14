# Analyse

## Warum zwei Engines?

|  | Stockfish | Maia |
|---|---|---|
| fragt | was der beste Zug ist | was ein Mensch auf den gewählten Spielstärken ziehen würde |
| rechnet | beim Import das Knotenbudget, das du festlegst (voreingestellt 500k); bei einer Analyse, die du anforderst, die Sekunden, die Tiefe oder die Knoten, die du wählst | ein Blick, keine Suche |
| liefert | so viele Varianten, wie der Durchlauf behält (voreingestellt 2, höchstens 5) | fünf Züge je Spielstärke, jeder mit Wahrscheinlichkeit |
| Varianten? | ja | nie |

Jede Zahl in dieser Tabelle ist eine Einstellung: Budget und Variantenzahl unter **Analyse
→ Engine-Durchläufe**, die Spielstärken unter **Analyse → Maia**.

## Welche Analyse bekommt eine Partie? { #which-pass-does-a-game-get }

Jede Partie, die ankommt, bekommt die Importanalyse: die Engine mit der Rolle **Analyse**,
Knotenbudget und Variantenzahl aus **Engine-Durchläufe**, in der Reihenfolge der
Warteschlange. Ausgewählte Zeilen unter **Partien** bekommen dasselbe über **Analyse
einreihen**.

Reicht dir das nicht, öffne die Partie und drück **Analysieren** (oder `A`). Du wählst die
Engine, die Zahl der Varianten, wann jeder Zug endet – nach so vielen Sekunden, bei einer
Tiefe oder nach so vielen Knoten – und ob ein Zug, alles ab einem Zug oder die ganze Partie
angesehen wird; den Dialog beschreibt [Eine Partie analysieren](game.md#ask-for-a-deeper-look).
Was du anforderst, zieht an jeder Importanalyse vorbei, die noch wartet.

Woraus eine Partie gelesen wird:

- Eine angeforderte Analyse schlägt die Importanalyse, egal welche später fertig wurde.
  Zwischen zwei Analysen derselben Art gewinnt die neuere.
- Eine Analyse über die ganze Partie gilt für die ganze Partie, Statistiken
  eingeschlossen. Eine Analyse über einen Teil gilt nur für diese Züge; den Rest liefert
  die Analyse darunter.
- Die Markierung in der Leiste über der Partie sagt, was gelaufen ist: `d24 · 2 Varianten`,
  `10s · 2 Varianten`, `500k · 2 Varianten`. Eine angeforderte Analyse ist farbig, die
  Importanalyse schlicht. Die Zeile der Partie unter **Partien** sagt nur
  **Analysiert** – farbig, sobald eine angeforderte Analyse darunter ist.

Eine Grenze in Sekunden hängt vom Rechner ab: Zehn Sekunden auf einem schnellen Server und
zehn Sekunden in einem Browser-Tab sind nicht dieselbe Suche. Tiefe und Knoten bedeuten
überall dasselbe.

## Was hat ein Zug gekostet?

Gewinnprozent vor dem Zug minus Gewinnprozent danach. Die voreingestellten Schwellen:

| Verlust | Markierung |
|---|---|
| 5 | `?!` Ungenauigkeit |
| 10 | `?` Fehler |
| 15 | `??` grober Patzer |

## Was ist noch zu analysieren? { #what-is-left-to-analyse }

**Analyse → Abdeckung** zeigt, wie viel der Bibliothek eine Engine schon gesehen hat und was
der Rest kosten würde. **Nachtragen** reiht die Importanalyse für jede Partie ein, die
noch keine Analyse hat; Partien, die schon eine haben, werden übersprungen. Bei einer
großen Bibliothek auf einem langsamen Server dauert das lange – dafür steht die Schätzung
auf der Karte. **Fehlende Stufen nachtragen** tut dasselbe für Maia. **Warteschlange
leeren** leert sie, und **Fehlgeschlagene Durchläufe** listet auf, was du wiederholen
kannst; eine Wiederholung läuft mit derselben Engine, Grenze, Zugauswahl und Variantenzahl
wie der fehlgeschlagene Versuch.

## Wie viel rechnet ein Durchlauf? { #how-much-work-does-a-pass-do }

**Analyse → Engine-Durchläufe → Analysedurchlauf** legt das Knotenbudget der Importanalyse
fest (voreingestellt 500.000), wie viele Varianten sie behält (1 bis 5, voreingestellt
zwei) und die drei Schwellen von oben. Budget und Variantenzahl werden beim Einreihen auf
den Durchlauf kopiert; eine Änderung gilt also für den nächsten. Von hier nimmt auch
**Analysieren** seine Knotenzahl, wenn du Knoten wählst, und die Variantenzahl, solange du
keine eintippst.

## Die Engine bei neuen Partien ausblenden { #hide-the-engine-on-new-games }

Auf derselben Seite steht **Neue Partien → Engine bei neuen Partien ausblenden**. Ist es
an, wird jede Partie, die du von da an importierst, wie gewohnt analysiert, kommt aber
stumm an: keine Bewertung, keine Markierung, kein Verlauf und keine Variante, bis du in der
Zeile unter dem Brett dieser Partie **Engine zeigen** drückst. Der Gedanke: erst die eigene
Partie lesen – wo ist sie gekippt? –, dann fragen. Partien, die schon in der Bibliothek
sind, bleiben, wie sie sind; ebenso Fernschachpartien und Musterpartien aus dem
Referenz-Explorer. In der Partienliste und auf der Startseite zeigt so eine Partie ein Auge
statt ihres schlechtesten Zugs. `⇧E` blendet weiterhin alles überall aus, zusätzlich dazu;
der Unterschied ist, dass `⇧E` ein Schalter des Browsers ist und dies an jeder Partie
gespeichert wird.

## Was wird Maia gefragt? { #what-is-maia-asked }

**Analyse → Maia** legt fest, welche Spielstärken gefragt werden – bis zu fünf Wertungen
zwischen 1100 und 2000, eine frische Installation fragt nur 2000 –, **Maia beim
Analysedurchlauf** – voreingestellt an; dann schaut Maia bei jedem Durchlauf mit, bei der
Importanalyse wie bei denen, die du anforderst – und **Nach beiden Seiten fragen**:
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
| **Knoten pro Aufgabe** | Was eine Aufgabe kostet, voreingestellt vierzig Millionen: ein bis zwei Minuten einer modernen Engine – gerade so, dass eine Erweiterung über ein Dutzend Stellungen fertig wird, während du noch aufs Brett schaust. Der Wert wird beim Einreihen auf die Aufgabe kopiert; änderst du ihn, gilt er für die nächste |
| **Linien pro Aufgabe** | Wie viele Kandidatenvarianten eine Aufgabe behält, 1 bis 5, voreingestellt drei – und damit, wie breit eine Erweiterung sein kann, denn die Kinder entstehen aus diesen Varianten |
| **Veraltet unter Tiefe** | Unter dieser Tiefe wird ein gespeichertes Urteil im Baum als veraltet markiert, 1 bis 100, voreingestellt dreißig. Die andere Hälfte braucht keine Zahl: Ein Urteil von einer Version der Engine, die nicht mehr installiert ist, ist veraltet, wie tief es auch ging |

Eine Engine-Einstellung gibt es nicht: Welche Engine sucht oder eine Aufgabe abarbeitet,
wählst du an der Stellung, im Dialog, aus allen eingeschalteten Engines – siehe
[Eine Stellung rechnen lassen](correspondence.md#search-a-position). Vorgeschlagen wird die
Engine mit der Rolle **Analyse**. Und es gibt hier keine Platzzahl: Wie viele Suchen
dieser Rechner gleichzeitig laufen lässt, ist eine Eigenschaft der Maschine, eingestellt
neben der Obergrenze der Warteschlange unter
[Maschinen](../operate/runners.md#how-much-at-once).

Ein leeres Feld heißt: die Voreinstellung gilt. Was der Modus selbst tut, steht unter
[Fernschach](correspondence.md); wie du ihm eine eigene Engine gibst, unter
[Engines](../operate/engines.md).
