# Partien

## Die Liste filtern

Der Schalter links in der Filterleiste wählt **Meine**, **Fremde** oder **Alle**: deine
eigenen Partien, die aus den Referenzdatenbanken übernommenen oder beides. Die Chips daneben
stehen je für eine Filtergruppe:

| Chip | Filtert nach |
|---|---|
| **Datum** | Gespielt von und bis, mit den Vorgaben 7 Tage, 30 Tage, 90 Tage und 12 Monate |
| **Quelle** | Lichess, Chess.com, FICS, OTB, PGN oder Meister |
| **Farbe** | Die Farbe, die du hattest |
| **Ergebnis** | Dein Ergebnis (Sieg, Niederlage, Remis) oder das PGN-Ergebnis (1-0, 0-1, ½-½) |
| **Eröffnung** | Ein ECO-Code oder ein Präfix: `C6` ist jede Caro-Kann von C60 bis C69 |
| **Bedenkzeit** | Eine Kategorie und eine genaue Uhr wie `600+0` |
| **Gegner** | Ein Teil des Namens |
| **Analyse** | Enthält einen groben Patzer, ist analysiert, hat eine Tiefenanalyse |

Die Zeile über der Tabelle zeigt, wie viele Partien passen. **Leeren** daneben setzt alle
Chips auf einmal zurück; jeder Chip hat zusätzlich sein eigenes Kreuz.

## In der Tabelle suchen

`/` setzt den Cursor ins Suchfeld. Gesucht wird in Gegnername, ECO-Code und im Text des PGN.

## Einen Filter speichern

**Filter speichern** gibt dem aktuellen Filter einen Namen und hängt ihn in der
Seitenleiste unter **Partien** ein, mit der Trefferzahl daneben. Drei sind vorgegeben:
**Niederlagen mit Schwarz**, **Grobe Patzer** und **Ohne Tiefenanalyse**. Fährst du über
einen selbst gespeicherten, erscheint das Kreuz zum Entfernen.

## Sortieren und blättern

Ein Klick auf eine Spaltenüberschrift sortiert danach, ein zweiter dreht die Richtung um.
Sortiert wird die ganze gefilterte Liste, nicht nur die sichtbare Seite. Die Fußzeile legt
die Zeilen pro Seite fest – **Fit** sind so viele, wie ins Fenster passen – und blättert mit
den Pfeilen neben der Zahl.

## Mehrere Partien auf einmal bearbeiten

Hake Zeilen an, oder das Kästchen im Kopf für die ganze Seite. Die Fußzeile bietet dann
**Schnellanalyse einreihen**, **Tiefenanalyse einreihen**, **Löschen** und **Auswahl
aufheben**. Was ein Durchlauf kostet, steht unter [Analyse](analysis.md).

## Partien löschen { #delete-games }

Das ✕ am Ende einer Zeile, oder eine Auswahl und **Löschen**. Die Rückfrage nennt die
Anzahl, denn mit der Partie verschwinden ihre Analyse, die Notizen zu ihr und die daran
angehefteten Varianten. Notizen zu einer *Stellung* bleiben. Es gibt kein Rückgängig. Die
Löschung wird gemerkt, damit eine spätere Synchronisierung die Partie nicht wieder
hereinholt; dieses Gedächtnis löschst du unter [Bibliothek → Verwalten](library.md#manage).

## Eine gefilterte Liste teilen

Die Filter stehen in der Adresszeile. Jeder Ausschnitt der Bibliothek ist also ein Link, den
du verschicken oder als Lesezeichen ablegen kannst. Die aktuelle Seite und die Zeilen pro
Seite gehören nicht dazu.
