# Partien

## Die Liste filtern { #filter-the-list }

Der Schalter links in der Filterleiste wählt **Meine**, **Fremde** oder **Alle**: deine
eigenen Partien, die aus den Referenzdatenbanken übernommenen oder beides. Die Chips daneben
stehen je für eine Filtergruppe:

| Chip | Filtert nach |
|---|---|
| **Datum** | Gespielt von und bis, mit den Vorgaben 7 Tage, 30 Tage, 90 Tage und 12 Monate |
| **Quelle** | Lichess, Chess.com, FICS, OTB, PGN, ICCF oder Meister |
| **Farbe** | Die Farbe, die du hattest |
| **Ergebnis** | Dein Ergebnis (Sieg, Niederlage, Remis) oder das PGN-Ergebnis (1-0, 0-1, ½-½) |
| **Eröffnung** | Ein ECO-Code oder ein Präfix: `C6` ist jede Caro-Kann von C60 bis C69 |
| **Bedenkzeit** | Eine Kategorie, eine genaue Uhr wie `600+0` und gewertet, ungewertet oder beides |
| **Gegner** | Ein Teil des Namens |
| **Analyse** | Enthält einen groben Patzer, ist analysiert |
| **Sammlung** | Eine deiner [Sammlungen](collections.md), jede mit ihrer Partienzahl |

Die Zeile über der Tabelle zeigt, wie viele Partien passen. **Leeren** daneben setzt alle
Chips auf einmal zurück; jeder Chip hat zusätzlich sein eigenes Kreuz.

In der Tabelle nennt die Spalte **Quelle** die Seite, mit einem farbigen Punkt davor. In
einer Lichess- oder Chess.com-Zeile ist sie ein Link, an dem ein kleiner Pfeil erscheint,
wenn du darauf zeigst: Er öffnet die Partie auf der Seite in einem neuen Tab, ohne hier die
Zeile zu öffnen. Ein hochgeladenes PGN behält den Link, wenn die Datei von einer der beiden
Seiten stammt. FICS-, OTB- und von Hand angelegte Fernschachpartien haben nirgends eine
Seite; bei ihnen steht nur der Name.

### Nach Sammlung filtern { #filter-by-collection }

**Sammlung** grenzt die Liste auf eine [Sammlung](collections.md) ein, wie jeder andere Chip
auch: Die übrigen Chips grenzen innerhalb davon weiter ein, **Leeren** nimmt sie mit dem Rest
weg, und sie bleibt bei deinen eigenen Partien, solange der Schalter links nicht auf
**Fremde** oder **Alle** steht. Eine Karte auf der Seite [Sammlungen](collections.md#open-a-collections-games) oder
der Chip einer Sammlung in einer Zeile öffnet die Liste genau so, mit **Alle**; dann steht
jede Partie der Sammlung darin.

## In der Tabelle suchen { #search-the-table }

`/` setzt den Cursor ins Suchfeld. Gesucht wird in Gegnername, ECO-Code und im Text des PGN.
**Esc** holt den Cursor wieder heraus; die Suche bleibt stehen.

## Einen Filter speichern { #save-a-filter }

**Filter speichern** gibt dem aktuellen Filter einen Namen und hängt ihn in der
Seitenleiste unter **Partien** ein, mit der Trefferzahl daneben. Zwei sind vorgegeben:
**Niederlagen mit Schwarz** und **Grobe Patzer**. Fährst du über
einen selbst gespeicherten, erscheint das Kreuz zum Entfernen. Wählst du einen aus, dort
oder über `⌘K`, bleibt die Tabelle so sortiert, wie sie war, und der Eintrag bleibt
hervorgehoben, egal wie du sortierst oder blätterst.

## Sortieren und blättern { #sort-and-page }

Ein Klick auf eine Spaltenüberschrift sortiert danach, ein zweiter dreht die Richtung um.
Sortiert wird die ganze gefilterte Liste, nicht nur die sichtbare Seite. Die Fußzeile legt
die Zeilen pro Seite fest – **Fit** sind so viele, wie ins Fenster passen – und blättert mit
den Pfeilen neben der Zahl.

Die Spalte **Analyse** sagt schlicht **Analysiert** oder **Nicht analysiert**, in Lila,
wenn eine von dir angeforderte Analyse dabei ist. Symbole gibt es in der Tabelle nur für
`??`, `?` und `?!`. Die Spalte **Verlust** ist erst ab einer Ungenauigkeit eingefärbt.

## Die Liste ohne Engine lesen { #read-the-list-without-the-engine }

`⇧E` oder der Computer in der Titelleiste nimmt jeder Zeile die Spalte **Verlust** und die
Symbole. Die Tabelle sagt dann, was du gespielt hast, und nicht, wie gut. Eine Liste, die
nach **Verlust** sortiert war, fällt solange auf „neueste zuerst“ zurück. Die Chips unter
**Analyse** wirken weiter – eine Frage, die du gestellt hast, ist keine Antwort, die dir
jemand gegeben hat – und die Schaltfläche, die eine Analyse einreiht, steht bei einer
Partie, die noch niemand angesehen hat, weiterhin da. Alles zum Modus steht unter
[Einstellungen](settings.md#hide-the-engine).

Eine Zeile, die in der Spalte **Verlust** ein Auge zeigt, während der Rest der Tabelle
aussieht wie immer, ist eine Partie, die mit ausgeblendeter Engine importiert wurde
([Analyse](analysis.md#hide-the-engine-on-new-games)); öffne sie und drück **Engine
zeigen**, wenn du sie gelesen hast.

## Mehrere Partien auf einmal bearbeiten { #act-on-several-games-at-once }

Hake Zeilen an, oder das Kästchen im Kopf für die ganze Seite; eine angehakte Zeile wird
blau, mit einem Balken am linken Rand. Die Fußzeile bietet dann **Hinzufügen zu…**,
**Analyse einreihen**, **Löschen** und **Auswahl aufheben**. **Hinzufügen zu…** legt sie in
eine Sammlung oder nimmt sie heraus, siehe
[Partien von Hand hinzufügen](collections.md#add-games-by-hand). Ist der Filter **Sammlung**
gesetzt, nimmt **Aus der Sammlung nehmen** sie aus genau dieser heraus, siehe
[Partien herausnehmen](collections.md#take-games-out). **Analyse einreihen** gibt
jeder Partie die Importanalyse, mit dem Budget und dem Platz in der Warteschlange, den jede
importierte Partie bekommt; genauer hinsehen lässt du bei einer einzelnen Partie mit
**Analysieren** in der Partie selbst. Was ein Durchlauf kostet, steht unter
[Analyse](analysis.md#which-pass-does-a-game-get).

## Partien löschen { #delete-games }

Das ✕ am Ende einer Zeile, oder eine Auswahl und **Löschen**. Die Rückfrage nennt die
Anzahl, denn mit der Partie verschwinden ihre Analyse, die Notizen zu ihr und die daran
angehefteten Varianten. Notizen zu einer *Stellung* bleiben. Es gibt kein Rückgängig. Die
Löschung wird gemerkt, damit eine spätere Synchronisierung die Partie nicht wieder
hereinholt; dieses Gedächtnis löschst du unter [Bibliothek → Verwalten](library.md#manage).

## Eine gefilterte Liste teilen { #share-a-filtered-list }

Die Filter stehen in der Adresszeile. Jeder Ausschnitt der Bibliothek ist also ein Link, den
du verschicken oder als Lesezeichen ablegen kannst. Auch Sortierung und aktuelle Seite
stehen darin; deshalb landest du nach dem Zurückgehen aus einer Partie – mit Zurück oder
über **Bibliothek** in der Pfadleiste darüber – wieder auf derselben Seite in derselben
Reihenfolge. Die Zeilen pro Seite gehören nicht dazu, die merkt sich dein
Browser für dich.
