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
| **Sammlung** | Eine deiner [Sammlungen](#collections), jede mit ihrer Partienzahl |

Die Zeile über der Tabelle zeigt, wie viele Partien passen. **Leeren** daneben setzt alle
Chips auf einmal zurück; jeder Chip hat zusätzlich sein eigenes Kreuz.

In der Tabelle nennt die Spalte **Quelle** die Seite, mit einem farbigen Punkt davor. In
einer Lichess- oder Chess.com-Zeile ist sie ein Link, an dem ein kleiner Pfeil erscheint,
wenn du darauf zeigst: Er öffnet die Partie auf der Seite in einem neuen Tab, ohne hier die
Zeile zu öffnen. Ein hochgeladenes PGN behält den Link, wenn die Datei von einer der beiden
Seiten stammt. FICS-, OTB- und von Hand angelegte Fernschachpartien haben nirgends eine
Seite; bei ihnen steht nur der Name.

## In der Tabelle suchen { #search-the-table }

`/` setzt den Cursor ins Suchfeld. Gesucht wird in Gegnername, ECO-Code und im Text des PGN.
**Esc** holt den Cursor wieder heraus; die Suche bleibt stehen.

## Einen Filter speichern { #save-a-filter }

**Filter speichern** gibt dem aktuellen Filter einen Namen und hängt ihn in der
Seitenleiste unter **Partien** ein, mit der Trefferzahl daneben. Zwei sind vorgegeben:
**Niederlagen mit Schwarz** und **Grobe Patzer**. Fährst du über
einen selbst gespeicherten, erscheint das Kreuz zum Entfernen.

## Sammlungen { #collections }

Eine Sammlung ist eine Gruppe von Partien mit Namen und Farbe: eine Ligasaison, die
Turnierpartien aus dem Verein, die Niederlagen, die du dir noch einmal vornehmen willst.
Eine Partie kann in mehreren zugleich stecken, und verschwinden lässt eine Sammlung nichts.
Ihre Partien zählen in dieser Liste, auf dem Dashboard, in den [Statistiken](stats.md) und
im [Explorer](explorer.md) wie jede andere; die Sammlung ist nur ein weiterer Schnitt durch
sie, und Statistiken und Explorer lassen sich auf sie eingrenzen. Ein gespeicherter Filter
ist eine Frage, die bei jedem Öffnen neu gestellt wird. Eine Sammlung ist eine Menge von
Partien, die so bleibt, wie du sie angelegt hast. Sie liegt in der Datenbank, ist also auf
jedem Gerät dieselbe, und dein [Assistent](coach.md) kann sie lesen.

### In der Seitenleiste { #in-the-rail }

Unter **Partien**, nach den gespeicherten Filtern, klappt **Sammlungen** auf: jede Sammlung
mit ihrer Farbe, ihrem Namen und der Zahl ihrer Partien. Ein Klick öffnet ihre Seite, **+**
legt eine neue an.

### In den Zeilen { #on-the-rows }

Steckt eine Partie in einer Sammlung, trägt sie in der Spalte **Symbole** vor den
Zugmarkierungen einen Chip in der Farbe der Sammlung, einen pro Sammlung; ein langer Name
wird gekürzt, damit er in die Spalte passt. Auf dem Telefon stehen die Chips auf der Karte
der Partie.

### Partien von Hand hinzufügen { #add-games-by-hand }

Hake Zeilen an und drück in der Fußzeile **Hinzufügen zu…**. Das ist eine Liste zum
Abhaken und keine Auswahl von genau einer, denn eine Partie darf in mehreren Sammlungen
stecken. Ein Haken heißt, dass jede ausgewählte Partie in dieser Sammlung ist, ein halber,
dass nur manche es sind. Ein Klick auf ein leeres oder halb abgehaktes Kästchen nimmt die
ganze Auswahl auf, ein Klick auf ein abgehaktes nimmt sie ganz heraus. **Neue Sammlung aus
diesen N Partien …** legt eine Sammlung an, die mit genau diesen Partien beginnt. In einer Partie
selbst steckt dieselbe Liste hinter dem **⋯**; siehe
[Eine Partie analysieren](game.md#collections).

### Die Seite einer Sammlung { #a-collections-page }

Die Seite einer Sammlung ist diese Liste, auf die Sammlung eingegrenzt
(`/games?collection=…`). Filterchips, Suche, Sortierung, Blättern und Auswahl funktionieren
also wie immer, und die Adresse ist ein Link. Die Titelleiste nennt sie nach **Partien**, mit
ihrer Farbe, und trägt **Bearbeiten** und **Statistiken**, wo die Bibliothek **Importieren**
hat; **Statistiken** öffnet die [Statistiken](stats.md#narrow-the-window) auf die Sammlung
eingegrenzt. Über den Filtern steht, was ein Filter allein nicht liefert:

- ihre Beschreibung, falls sie eine hat;
- eine Bilanz über deine Partien in der Sammlung, aus deiner Sicht: Punkte aus Partien,
  Siege, Remis und Niederlagen, die durchschnittliche Wertung deiner Gegner und grobe Patzer
  pro Partie. Gezählt wird nur, wo du eine Seite hast: Eine fremde Partie in der Sammlung
  oder eine eigene, deren Seite noch niemand kennt (eine PGN unter einem Namen, der kein
  Konto ist), steht in der Liste, geht aber nicht in die Bilanz ein;
- die Regel, falls es eine gibt, als kleine Chips mit **nimmt neue Importe auf** daneben.

Sind Zeilen angehakt, bietet die Fußzeile hier zusätzlich **Aus der Sammlung nehmen**. Anders
als die übrige Liste beginnt die Seite bei **Alle**. Sie zeigt also jede Partie, die die
Seitenleiste zählt, auch eine fremde, die du von Hand hineingelegt hast; **Meine** und
**Fremde** grenzen sie ein wie überall.

### Eine Sammlung anlegen { #make-a-collection }

**Sammlung anlegen** erscheint neben **Filter speichern**, sobald ein Filter gesetzt ist, den
eine Regel fassen kann: Quelle, Bedenkzeit, Kategorie, gewertet, Farbe, Gegner oder
Eröffnung. Der Link öffnet den Sammlungsdialog mit einer Regel, die aus diesen Filtern schon
ausgefüllt ist. Meist legst du eine Sammlung so an: Du filterst die Liste, bis sie zeigt, was
in die Sammlung gehört, und drückst dann den Link. Eine Liga, die auf Lichess mit 45+45
gespielt wird, ist **Quelle** Lichess, **Bedenkzeit** `2700+45` (Lichess schreibt die Uhr in
Sekunden) und gewertet; so bleibt eine ungewertete 45+45-Partie mit einem Freund draußen. Ist
kein solcher Filter gesetzt, legst du eine Sammlung über das **+** in der Seitenleiste an
oder mit angehakten Partien über **Hinzufügen zu…**.

Der Dialog fragt nach einem Namen, einer Farbe und, wenn du willst, einer Beschreibung.
**Neue passende Partien aufnehmen** schaltet die Regel ein, mit **Quelle**, **Bedenkzeit**
(die genaue Uhr, etwa `2700+45`), **Kategorie**, **Gewertet** (beides, gewertet oder
ungewertet), **Farbe**, **Gegner** und **Eröffnung (ECO)**. Von deinen offenen Filtern kommen
die mit, die eine Regel fassen kann. Datum, Ergebnis, die Analyse-Chips und das Suchfeld
bleiben zurück, denn eine Regel sagt, welche Art Partie dazugehört, nicht, wann sie gespielt
wurde oder wie sie ausging. Unter den Feldern zählt der Dialog, wie viele deiner vorhandenen
Partien die Regel erfüllen, und das Kästchen daneben nimmt sie gleich mit auf. Kommst du über
**Sammlung anlegen**, ist es schon angehakt. Die Zahl kann größer sein als die Liste, die du
vor dir hattest, wenn du diese auch nach Datum oder Ergebnis eingegrenzt hattest. Unter
**Bearbeiten** zählt der Dialog nur die passenden Partien, die noch nicht in der Sammlung
sind; dazu gehören auch die, die du von Hand herausgenommen hast.

**Bearbeiten** auf der Seite einer Sammlung öffnet denselben Dialog. Dort steht auch
**Löschen …**, mit Rückfrage; die Partien einer gelöschten Sammlung bleiben in der Bibliothek.

### Wann eine Regel greift { #when-a-rule-runs }

Eine Regel sieht sich jede Partie an, während sie gespeichert wird – bei einer
Synchronisierung, einer automatischen Synchronisierung, über den Lichess-Livestream, aus
einer hochgeladenen PGN oder von Hand eingetragen – und legt sie in jede Sammlung, deren
Regel sie erfüllt. Sie nimmt nur deine eigenen Partien; eine Musterpartie, die du in die
Bibliothek übernimmst, kommt nur von Hand in eine Sammlung. Ist die Seite einer Partie beim
Ankommen noch unbekannt, etwa bei einer PGN unter einem Namen, der noch kein Konto ist,
fragen die Regeln mit einer Farbe noch einmal nach, sobald du das Konto anlegst und die Seite
feststeht. Von sich aus geht eine Regel nie
über die Bibliothek zurück. Änderst du sie, bleiben die Partien, die schon in der Sammlung
sind, wie sie sind; vorhandene Partien kommen nur dazu, wenn du das Kästchen anhakst, das sie
gleich mit aufnimmt.

### Partien herausnehmen { #take-games-out }

**Aus der Sammlung nehmen** auf der Seite der Sammlung, oder der entfernte Haken in
**Hinzufügen zu…**, nimmt Partien heraus, und sie bleiben draußen. Die nächste
Synchronisierung holt sie nicht zurück, denn die Regel hat sie nur einmal angesehen, als sie
ankamen. Nur wenn du im Dialog die passenden Partien noch einmal aufnehmen lässt, sind sie
wieder drin. Eine gelöschte Partie verschwindet aus jeder Sammlung, in der sie war.

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
eine Sammlung, siehe [Partien von Hand hinzufügen](#add-games-by-hand). **Analyse einreihen** gibt
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
du verschicken oder als Lesezeichen ablegen kannst. Die aktuelle Seite und die Zeilen pro
Seite gehören nicht dazu.
