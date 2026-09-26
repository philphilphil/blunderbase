# Statistiken

## Welche Berichte gibt es?

**Statistiken** zeigt einen Bericht auf einmal, ausgewählt in der Seitenleiste:

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

## Welche Partien zählen?

Nur deine eigenen, und davon nur die analysierten. Die Kachel **Partien** sagt, wie viele
Partien des Zeitraums analysiert sind. Als fremd markierte Partien zählen nirgends. Wirkt
ein Bericht dünn, sieh unter **Analyse → Abdeckung** nach.

## Den Zeitraum eingrenzen { #narrow-the-window }

Über dem Bericht stehen vier Steuerelemente: **Zeitraum** (7 Tage, 30 Tage, 90 Tage, ein
Jahr oder alles), **Farbe**, **Bedenkzeit** und **Sammlung**. **vs. davor** stellt jede Zahl
dem gleich langen Zeitraum davor gegenüber; bei „alles“ gibt es nichts zu vergleichen.

**Sammlung** erscheint, sobald du eine [Sammlung](games.md#collections) angelegt hast. Es
steht auf **Alle Partien**, bis du eine wählst. Dann rechnet der ganze Bericht nur mit deinen
Partien in dieser Sammlung – so bekommt eine Ligasaison ihre eigenen Statistiken. Eine
fremde Partie, die du von Hand hineingelegt hast, zählt hier so wenig wie sonst in den
Statistiken. Der Link **Statistiken** auf der Seite einer Sammlung öffnet den Bericht mit ihr
schon gewählt, und die Wahl steht in der Adresse der Seite, auch wenn du in der Seitenleiste
den Bericht wechselst. Ist keine Sammlung gewählt, zählen ihre Partien hier
wie jede andere: Eine Sammlung grenzt die Statistiken ein, sie nimmt nie Partien aus ihnen
heraus.

## Als CSV exportieren

**CSV exportieren** lädt den gerade angezeigten Bericht herunter, mit genau den Filtern, die
du gesetzt hast.
