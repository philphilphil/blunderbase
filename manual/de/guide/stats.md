# Statistiken

## Welche Berichte gibt es? { #what-do-the-reports-show }

**Statistiken** zeigt einen Bericht auf einmal, ausgewählt in der Seitenleiste. Die
Titelleiste nennt ihn: **Statistiken › Übersicht**, **Statistiken › Verhalten an der Uhr**,
und ein Klick auf **Statistiken** dort führt zurück zur Übersicht.

| Bericht | Beantwortet |
|---|---|
| **Übersicht** | Partiephase, Bedenkzeit, Zeitnot, Entwicklung |
| **Patzer-Typologie** | Wo grobe Patzer passieren und was sie auslöst |
| **Verhalten an der Uhr** | Zeitnot und Tageszeit |
| **Fortschritt** | Wertung über den Zeitraum |

Die Wertung einer Partie ist die, die du nach ihrem Ende hattest. Lichess und chess.com
liefern beide, was eine Partie an der Wertung geändert hat, und eine PGN mit
`WhiteRatingDiff`-Tags ebenso; jeder Punkt der Fortschrittslinie enthält also schon das
Ergebnis dieser Partie. Eine ungewertete Partie oder eine PGN ohne diese Tags behält die
Wertung, mit der du in sie gegangen bist.

## Welche Partien zählen? { #which-games-are-counted }

Nur deine eigenen, und davon nur die analysierten. Die Kachel **Partien** sagt, wie viele
Partien des Zeitraums analysiert sind. Als fremd markierte Partien zählen nirgends. Wirkt
ein Bericht dünn, sieh unter **Analyse › Abdeckung** nach.

## Den Zeitraum eingrenzen { #narrow-the-window }

Die Zeile über dem Bericht legt fest, was jede Zahl darin zählt. **Zeitraum** (alles, ein
Jahr, 90 Tage oder 30 Tage) und **Farbe** (beide, Weiß oder Schwarz) sind je eine Wahl
aus wenigen. Die Auswahl **Bedenkzeit** zeigt **Bedenkzeit: Alle**, solange du nichts
eingrenzt; ein Klick öffnet je Bedenkzeit ein Kästchen, und danach nennt sie, was noch an ist
(**Bedenkzeit: Blitz, Schnellschach**). Die letzte lässt sich nicht abwählen, und das **×**
neben einer eingegrenzten Auswahl schaltet alle wieder ein. Eine Partie ohne Datum, etwa aus
einer PGN mit `Date "????.??.??"`, zählt nur bei „alles“.

Am Ende der Zeile stellt der Schalter **vs. Zeitraum davor** jede Zahl dem gleich langen
Zeitraum davor gegenüber. Vor „alles“ liegt nichts, deshalb ist der Schalter dort aus und
ausgegraut.

Die Auswahl **Sammlung** erscheint, sobald du eine [Sammlung](collections.md) angelegt
hast. Sie zeigt **Sammlung: Alle Partien**, bis du eine wählst. Dann rechnet der ganze Bericht nur mit deinen
Partien in dieser Sammlung – so bekommt eine Ligasaison ihre eigenen Statistiken. Eine
fremde Partie, die du von Hand hineingelegt hast, zählt hier so wenig wie sonst in den
Statistiken. Der Link **Statistiken** auf der Karte einer Sammlung
([Sammlungen](collections.md#open-a-collections-games)) öffnet den Bericht mit ihr schon
gewählt, und die Wahl steht in der Adresse der Seite, auch wenn du in der Seitenleiste
den Bericht wechselst. Ist keine Sammlung gewählt, zählen ihre Partien hier
wie jede andere: Eine Sammlung grenzt die Statistiken ein, sie nimmt nie Partien aus ihnen
heraus.

## Als CSV exportieren { #export-as-csv }

**CSV exportieren** in der Titelleiste lädt den gerade angezeigten Bericht herunter, mit
genau den Filtern, die du gesetzt hast.
