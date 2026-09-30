# Partien

Die Titelleiste sagt, welche Liste du gerade liest: **Partien** für die ganze Bibliothek,
**Partien › Niederlagen mit Schwarz** für einen deiner gespeicherten Filter,
**Sammlungen › Liga 2026** für eine Sammlung, die in der Seitenleiste angeheftet ist, und
**Partien (gefiltert)** für jeden anderen Filter. **Partien importieren** am rechten Ende
führt zu [Bibliothek › Importieren](library.md).

## Die Liste filtern { #filter-the-list }

Der Schalter links in der Filterleiste wählt **Meine**, **Fremde** oder **Alle**: deine
eigenen Partien, die aus den Referenzdatenbanken übernommenen oder beides. Hinter dem
schmalen Strich daneben steht je Filtergruppe eine Auswahl. Sie trägt ihren Namen, und
sobald sie gesetzt ist, Namen und Wert („Ergebnis: Niederlage“); eine gesetzte Auswahl wird
blau und bekommt ihr eigenes Kreuz.

| Auswahl | Filtert nach |
|---|---|
| **Datum** | Gespielt von und bis, mit den Vorgaben Heute, 7 Tage, 30 Tage, 90 Tage und 1 Jahr |
| **Quelle** | Lichess, Chess.com, FICS, OTB, PGN, ICCF oder Meister |
| **Farbe** | Die Farbe, die du hattest |
| **Ergebnis** | Dein Ergebnis (Sieg, Niederlage, Remis) oder das PGN-Ergebnis (1-0, 0-1, ½-½) |
| **Eröffnung** | Ein ECO-Code oder ein Präfix: `C6` ist jede Caro-Kann von C60 bis C69 |
| **Bedenkzeit** | Eine Kategorie, eine genaue Uhr wie `600+0` und gewertet, ungewertet oder beides |
| **Gegner** | Ein Teil des Namens |
| **Analyse** | Enthält einen groben Patzer, ist analysiert |
| **Sammlung** | Eine deiner [Sammlungen](collections.md), jede mit ihrer Partienzahl |

Die Fußzeile zeigt, wie viele Partien passen. **… zurücksetzen** am rechten Ende der
Filterleiste, mit der Zahl der gesetzten Filter davor, nimmt alle auf einmal weg; das Kreuz
einer Auswahl nimmt nur ihre Gruppe weg.

In der Tabelle nennt die Spalte **Quelle** die Seite, mit einem farbigen Punkt davor. In
einer Lichess- oder Chess.com-Zeile ist sie ein Link, an dem ein kleiner Pfeil erscheint,
wenn du darauf zeigst: Er öffnet die Partie auf der Seite in einem neuen Tab, ohne hier die
Zeile zu öffnen. Ein hochgeladenes PGN behält den Link, wenn die Datei von einer der beiden
Seiten stammt. FICS-, OTB- und von Hand angelegte Fernschachpartien haben nirgends eine
Seite; bei ihnen steht nur der Name.

### Nach Sammlung filtern { #filter-by-collection }

**Sammlung** grenzt die Liste auf eine [Sammlung](collections.md) ein, wie jede andere
Auswahl auch: Die übrigen grenzen innerhalb davon weiter ein, und das Zurücksetzen nimmt sie
mit dem Rest weg. Wer eine Sammlung wählt, stellt damit den Schalter links auf **Alle**: Dann
steht jede Partie der Sammlung in der Liste, so viele, wie neben ihrem Namen stehen. Mit
**Meine** bleiben nur die eigenen übrig. Eine Karte auf der Seite
[Sammlungen](collections.md#open-a-collections-games), eine in der Seitenleiste angeheftete
Sammlung oder der Chip einer Sammlung in einer Zeile öffnet die Liste genauso. Solange die
Liste genau eine Sammlung zeigt und sonst nichts, heißt der Titel **Sammlungen › ihr Name**,
und **Sammlung bearbeiten …** neben **Partien importieren** öffnet denselben Dialog wie die
Karte der Sammlung ([Bearbeiten und löschen](collections.md#edit-and-delete)); jeder weitere
Filter macht wieder **Partien (gefiltert)** daraus.

## In der Tabelle suchen { #search-the-table }

Das Feld **Partien filtern: Gegner, ECO, PGN …** am rechten Ende der Filterleiste sucht in
Gegnername, ECO-Code und im Text des PGN. `/` setzt den Cursor von überall auf der Seite
hinein; **Esc** holt ihn wieder heraus, die Suche bleibt stehen.

## Einen Filter speichern { #save-a-filter }

**Filter speichern …** neben dem Suchfeld gibt dem aktuellen Filter einen Namen und hängt
ihn in der Seitenleiste unter **Partien** ein, mit der Trefferzahl daneben. Solange kein
Filter gesetzt ist, bleibt die Schaltfläche grau: Es gibt noch nichts zu speichern. Zwei
sind vorgegeben:
**Niederlagen mit Schwarz** und **Grobe Patzer**. Fährst du über
einen selbst gespeicherten, erscheint das Kreuz zum Entfernen. Wählst du einen aus, dort
oder über `⌘K`, bleibt die Tabelle so sortiert, wie sie war, und der Eintrag bleibt
hervorgehoben, egal wie du sortierst oder blätterst.

## Sortieren und blättern { #sort-and-page }

Ein Klick auf eine Spaltenüberschrift sortiert danach, ein zweiter dreht die Richtung um;
die sortierte Spalte trägt einen Pfeil. Sortiert wird die ganze gefilterte Liste, nicht nur
die sichtbare Seite. **Zeilen** in der Fußzeile legt fest, wie viele Zeilen eine Seite hat –
**Fit** sind so viele, wie ins Fenster passen –, und ‹ › daneben blättern um die aktuelle
Seite herum. Ist das Fenster zu schmal für alle Spalten, lässt sich die Tabelle seitwärts
schieben; ein Verlauf am rechten Rand zeigt, dass dort noch mehr steht.

Die Spalte **Analyse** sagt schlicht **Analysiert**, in Lila, wenn eine von dir angeforderte
Analyse dabei ist. Bei einer Partie, die noch nichts analysiert hat, steht dort
**Analysieren**, das ihre Analyse einreiht; wartet sie in der Warteschlange oder wird gerade
analysiert, steht dort stattdessen **In der Warteschlange**. Symbole gibt es in der Tabelle
nur für `??`, `?` und `?!`. Die Spalte **Verlust** ist erst ab einer Ungenauigkeit
eingefärbt.
Die letzte Spalte, **Sammlungen**, nennt die Sammlungen, in denen eine Partie liegt, durch
Kommas getrennt; sie erscheint erst, wenn du eine Sammlung angelegt hast.

## Die Liste ohne Engine lesen { #read-the-list-without-the-engine }

`⇧E` oder der Schalter **Engine ausblenden** in der Titelleiste nimmt der Tabelle die
Spalten **Verlust** und **Symbole**. Die Tabelle sagt dann, was du gespielt hast, und nicht,
wie gut. Eine Liste, die nach **Verlust** sortiert war, fällt solange auf „neueste zuerst“
zurück. Der Filter **Analyse** wirkt weiter – eine Frage, die du gestellt hast, ist keine
Antwort, die dir jemand gegeben hat –, und **Analysieren**, das eine Partie einreiht, die
noch niemand angesehen hat, steht weiterhin in ihrer Zeile. Alles zum Modus steht unter
[Einstellungen](settings.md#hide-the-engine).

Eine Zeile, die in den Spalten **Verlust** und **Symbole** ein Auge zeigt, während der Rest der Tabelle
aussieht wie immer, ist eine Partie, die mit ausgeblendeter Engine importiert wurde
([Analyse](analysis.md#hide-the-engine-on-new-games)); öffne sie und drück **Engine
zeigen**, wenn du sie gelesen hast.

## Mehrere Partien auf einmal bearbeiten { #act-on-several-games-at-once }

Hake Zeilen an, oder das Kästchen im Kopf für die ganze Seite; eine angehakte Zeile wird
blau, mit einem Balken am linken Rand, und das Kästchen im Kopf zeigt einen Strich, solange
nur manche angehakt sind. Die Fußzeile nennt dann, wie viele ausgewählt sind, und bietet in
dieser Reihenfolge **Auswahl aufheben**, **Hinzufügen zu**, **Analyse einreihen** (die eine
gefüllte Schaltfläche) und, etwas abgesetzt, **Löschen …**. **Hinzufügen zu** legt sie in
eine Sammlung oder nimmt sie heraus, siehe
[Partien von Hand hinzufügen](collections.md#add-games-by-hand). Ist der Filter **Sammlung**
gesetzt, nimmt **Aus der Sammlung nehmen** sie aus genau dieser heraus, siehe
[Partien herausnehmen](collections.md#take-games-out). **Analyse einreihen** gibt
jeder Partie die Importanalyse, mit dem Budget und dem Platz in der Warteschlange, den jede
importierte Partie bekommt; genauer hinsehen lässt du bei einer einzelnen Partie mit
**Analysieren …** in der Partie selbst. Was ein Durchlauf kostet, steht unter
[Analyse](analysis.md#which-pass-does-a-game-get).

## Partien löschen { #delete-games }

Der Papierkorb am Ende einer Zeile, der erscheint, wenn du auf die Zeile zeigst, oder eine
Auswahl und **Löschen …**. Die Rückfrage nennt die
Anzahl, denn mit der Partie verschwinden ihre Analyse, die Notizen zu ihr und die daran
angehefteten Varianten. Notizen zu einer *Stellung* bleiben. Es gibt kein Rückgängig. Die
Löschung wird gemerkt, damit eine spätere Synchronisierung die Partie nicht wieder
hereinholt; dieses Gedächtnis löschst du unter [Bibliothek › Verwalten](library.md#manage).

## Eine gefilterte Liste teilen { #share-a-filtered-list }

Die Filter stehen in der Adresszeile. Jeder Ausschnitt der Bibliothek ist also ein Link, den
du verschicken oder als Lesezeichen ablegen kannst. Auch Sortierung und aktuelle Seite
stehen darin; deshalb landest du nach dem Zurückgehen aus einer Partie – mit Zurück oder
über den Pfad in ihrer Titelleiste – wieder auf derselben Seite in derselben
Reihenfolge. Die Zeilen pro Seite gehören nicht dazu, die merkt sich dein
Browser für dich.
