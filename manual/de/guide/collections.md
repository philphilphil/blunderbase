# Sammlungen

Eine Sammlung ist eine Gruppe von Partien mit Namen und Farbe: eine Ligasaison, die
Turnierpartien aus dem Verein, die Niederlagen, die du dir noch einmal vornehmen willst.
Eine Partie kann in mehreren zugleich stecken, und verschwinden lässt eine Sammlung nichts.
Ihre Partien zählen unter [Partien](games.md), auf dem Dashboard, in den
[Statistiken](stats.md) und im [Explorer](explorer.md) wie jede andere; die Sammlung ist nur
ein weiterer Schnitt durch sie, und Statistiken und Explorer lassen sich auf sie eingrenzen.
Ein gespeicherter Filter ist eine Frage, die bei jedem Öffnen neu gestellt wird. Eine
Sammlung ist eine Menge von Partien, die so bleibt, wie du sie angelegt hast. Sie liegt in
der Datenbank, ist also auf jedem Gerät dieselbe, und dein [Assistent](coach.md) kann sie
lesen.

Du erreichst diese Seite über **Sammlungen** in der Seitenleiste, direkt unter **Partien**,
und von überall mit `⌘6`.

## Die Karten { #the-cards }

Jede Sammlung hat eine Karte. Die Karten stehen nebeneinander, soweit das Fenster Platz
lässt, auf dem Telefon untereinander. Jede Karte hat dieselben Teile an denselben Stellen,
damit nebeneinanderstehende Karten auf einer Linie liegen. Eine Karte zeigt:

- Farbe und Namen der Sammlung und wie viele Partien in ihr stecken;
- eine Zeile Beschreibung, leer, wenn sie keine hat;
- vier Kennzahlen über deine Partien darin, aus deiner Sicht: **Deine Bilanz** (Punkte aus
  Partien), **Ergebnisse** (Siege, Remis und Niederlagen), **Gegner im Schnitt** (die
  durchschnittliche Wertung deiner Gegner) und **Grobe Patzer / Partie**. Gezählt wird nur,
  wo du eine Seite hast. Eine fremde Partie in der Sammlung oder eine eigene, deren Seite
  noch niemand kennt (eine PGN unter einem Namen, der kein Konto ist), steckt in der
  Partienzahl, geht aber nicht in die Bilanz ein; fährst du über die Bilanz, steht dort, wie
  viele fehlen. Hinter einer Kennzahl, für die es noch nichts gibt – kein gewerteter Gegner,
  nichts analysiert –, steht ein Strich;
- die Regel als kleine Chips mit **nimmt neue Importe auf** daneben, oder **Keine Regel · von
  Hand gefüllt**;
- wann die letzte Partie darin gespielt wurde.

Der Umschalter über den Karten macht aus ihnen eine **Tabelle**: eine Zeile je Sammlung, mit
denselben Kennzahlen in Spalten, für den Fall, dass es genug Sammlungen gibt, um sie Spalte
für Spalte zu vergleichen. Regel, Gegner im Schnitt und grobe Patzer pro Partie kommen bei
einem breiten Fenster dazu. Eine Zeile öffnet und bearbeitet ihre Sammlung wie eine Karte.
Dieser Browser merkt sich die Wahl.

Gibt es noch keine Sammlung, erklärt die Seite, was eine ist, und bietet **Neue Sammlung**
an.

## Die Partien einer Sammlung öffnen { #open-a-collections-games }

Ein Klick auf eine Karte öffnet [Partien](games.md) mit dem Filter **Sammlung** auf diese
Sammlung und **Wessen Partien** auf **Alle**. Die Liste enthält also jede Partie, die die
Karte gezählt hat, auch eine fremde, die du von Hand hineingelegt hast. Von da an ist es die
gewohnte Bibliothek: Die übrigen Filter, die Suche, das Sortieren und die Auswahl
funktionieren wie immer, **Meine** grenzt auf deine eigenen Partien ein, und das
Zurücksetzen der Filter nimmt die Sammlung mit allem anderen weg.

**Statistiken** unten auf einer Karte (in der Tabelle das Diagramm am Ende der Zeile) öffnet die [Statistiken](stats.md#narrow-the-window)
auf die Sammlung eingegrenzt.

Eine Partie in einer Sammlung trägt außerdem einen Chip in deren Farbe: in der Spalte
**Symbole** der Partienliste (auf dem Telefon auf der Karte der Partie) und in der Leiste
über einer geöffneten Partie; ein langer Name wird gekürzt. Ein Klick auf den Chip öffnet
dieselbe Liste wie die Karte.

## Bearbeiten und löschen { #edit-and-delete }

**Bearbeiten** unten auf einer Karte (in der Tabelle der Stift am Ende der Zeile) öffnet den Sammlungsdialog für sie: Name, Farbe,
Beschreibung und Regel, wie unter [Eine Sammlung anlegen](#make-a-collection). Beim
Bearbeiten zählt der Dialog nur die passenden Partien, die noch nicht in der Sammlung sind;
dazu gehören auch die, die du von Hand herausgenommen hast. Dort steht auch **Löschen …**,
mit Rückfrage; die Partien einer gelöschten Sammlung bleiben in der Bibliothek.

## Eine Sammlung anlegen { #make-a-collection }

Es gibt drei Wege:

- **Neue Sammlung** in der Titelleiste dieser Seite, noch ohne Partien.
- **Sammlung anlegen** in der Partienliste, neben **Filter speichern**. Der Link erscheint,
  sobald ein Filter gesetzt ist, den eine Regel fassen kann: Quelle, Bedenkzeit, Kategorie,
  gewertet, Farbe, Gegner oder Eröffnung. Er öffnet den Dialog mit einer Regel, die aus
  diesen Filtern schon ausgefüllt ist. Meist legst du eine Sammlung so an: Du filterst die
  Liste, bis sie zeigt, was hineingehört, und drückst dann den Link. Eine Liga, die auf
  Lichess mit 45+45 gespielt wird, ist **Quelle** Lichess, **Bedenkzeit** `2700+45`
  (Lichess schreibt die Uhr in Sekunden) und gewertet; so bleibt eine ungewertete
  45+45-Partie mit einem Freund draußen. Nach dem Speichern zeigt die Liste die Partien der
  neuen Sammlung.
- **Neue Sammlung aus diesen N Partien …** unter **Hinzufügen zu…**, mit angehakten Partien
  in der Liste; siehe [Partien von Hand hinzufügen](#add-games-by-hand).

Der Dialog fragt nach einem Namen, einer Farbe und, wenn du willst, einer Beschreibung.
**Neue passende Partien aufnehmen** schaltet die Regel ein, mit **Quelle**, **Bedenkzeit**
(die genaue Uhr, etwa `2700+45`), **Kategorie**, **Gewertet** (beides, gewertet oder
ungewertet), **Farbe**, **Gegner** und **Eröffnung (ECO)**. Von deinen offenen Filtern kommen
die mit, die eine Regel fassen kann. Datum, Ergebnis, die Analyse-Chips und das Suchfeld
bleiben zurück, denn eine Regel sagt, welche Art Partie dazugehört, nicht, wann sie gespielt
wurde oder wie sie ausging. Unter den Feldern zählt der Dialog, wie viele deiner vorhandenen
Partien die Regel erfüllen, und das Kästchen daneben nimmt sie gleich mit auf. Kommst du über
**Sammlung anlegen**, ist es schon angehakt. Die Zahl kann größer sein als die Liste, die du
vor dir hattest, wenn du diese auch nach Datum oder Ergebnis eingegrenzt hattest.

## Partien von Hand hinzufügen { #add-games-by-hand }

Hake unter [Partien](games.md#act-on-several-games-at-once) Zeilen an und drück in der
Fußzeile **Hinzufügen zu…**. Das ist eine Liste zum Abhaken und keine Auswahl von genau
einer, denn eine Partie darf in mehreren Sammlungen stecken. Ein Haken heißt, dass jede
ausgewählte Partie in dieser Sammlung ist, ein halber, dass nur manche es sind. Ein Klick
auf ein leeres oder halb abgehaktes Kästchen nimmt die ganze Auswahl auf, ein Klick auf ein
abgehaktes nimmt sie ganz heraus. **Neue Sammlung aus diesen N Partien …** legt eine
Sammlung an, die mit genau diesen Partien beginnt. In einer Partie selbst steckt dieselbe
Liste hinter dem **⋯**; siehe [Eine Partie analysieren](game.md#collections).

## Wann eine Regel greift { #when-a-rule-runs }

Eine Regel sieht sich jede Partie an, während sie gespeichert wird – bei einer
Synchronisierung, einer automatischen Synchronisierung, über den Lichess-Livestream, aus
einer hochgeladenen PGN oder von Hand eingetragen – und legt sie in jede Sammlung, deren
Regel sie erfüllt. Sie nimmt nur deine eigenen Partien; eine Musterpartie, die du in die
Bibliothek übernimmst, kommt nur von Hand in eine Sammlung. Ist die Seite einer Partie beim
Ankommen noch unbekannt, etwa bei einer PGN unter einem Namen, der noch kein Konto ist,
fragen die Regeln mit einer Farbe noch einmal nach, sobald du das Konto anlegst und die Seite
feststeht – aber nur die, die es beim Ankommen der Partie schon so gab, wie sie jetzt sind.
Eine später angelegte oder geänderte Regel nimmt so eine Partie nur auf, wenn du im Dialog
die passenden Partien hinzufügst. Von sich aus geht eine Regel nie über die Bibliothek
zurück. Änderst du sie,
bleiben die Partien, die schon in der Sammlung sind, wie sie sind; vorhandene Partien kommen
nur dazu, wenn du das Kästchen anhakst, das sie gleich mit aufnimmt.

## Partien herausnehmen { #take-games-out }

Ist in der Partienliste der Filter **Sammlung** gesetzt, bietet die Fußzeile für angehakte
Zeilen **Aus der Sammlung nehmen**. Damit, oder mit dem entfernten Haken in
**Hinzufügen zu…**, nimmst du Partien heraus, und sie bleiben draußen. Die nächste
Synchronisierung holt sie nicht zurück, denn die Regel hat sie nur einmal angesehen, als sie
ankamen. Nur wenn du im Dialog die passenden Partien noch einmal aufnehmen lässt, sind sie
wieder drin. Eine gelöschte Partie verschwindet aus jeder Sammlung, in der sie war.
