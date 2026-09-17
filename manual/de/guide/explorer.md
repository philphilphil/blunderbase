# Explorer

## Deine eigenen Eröffnungen

Der **Explorer** stellt ein Brett neben deinen Zugbaum. Spiel einen Zug, und die Tabelle
zeigt, wie oft du diese Stellung hattest, wie du abgeschnitten hast und welcher Zug dort
dein schlechtester war. `←` und `→` gehen die Variante entlang. **Partien in dieser
Variante** und **Deine Notizen zu dieser Stellung** stehen daneben.

Mit den Chips über der Tabelle legst du fest, welche deiner Partien zählen: **Bedenkzeit**
lässt nur die eingeschalteten Zeitkontrollen übrig, **gespielt** nur Partien der letzten
30 Tage, 90 Tage oder des letzten Jahres, von heute an gerechnet. Der Baum, seine
Buchvariante und die Partien darunter richten sich danach, und der Filter steht in der
Adresse der Seite – ein gefilterter Baum ist also ein Link.

## Die Lichess-Referenzdatenbanken

Dasselbe Brett liest auch zwei Datenbanken von Lichess: **Meister**, Turnierpartien am Brett
zwischen Titelträgern, und die gewerteten Lichess-Partien, eingrenzbar nach Bedenkzeit und
Wertungsbereich. Beides wird nicht gespeichert und zählt nicht in deine eigenen Zahlen.

## Mit Lichess verbinden { #connect-lichess }

Beide Referenzdatenbanken beantworten nur angemeldete Anfragen. Öffnest du eine zum ersten
Mal, bietet sie **Mit Lichess verbinden** an: Du erlaubst Blunderbase auf lichess.org den
Zugriff und landest wieder in derselben Stellung, diesmal mit gefüllter Tabelle. Die
Freigabeseite nennt „Read incoming challenges“; diese Berechtigung braucht der
[Live-Import](library.md#import-lichess-games-live), die Datenbanken selbst brauchen keine.
Nimmt Lichess die Verbindung später nicht mehr an, weil du sie auf lichess.org widerrufen
hast oder sie nach einem Jahr abgelaufen ist, steht an derselben Stelle **Lichess neu
verbinden**.

Ein Token, das du in einer früheren Version eingefügt hast, funktioniert für die
Datenbanken weiter. Für den Live-Import verbindest du dich auf der Importseite einmal neu.

## Eine Musterpartie öffnen { #open-a-model-game }

**Musterpartien** listet Partien aus diesen Datenbanken. Eine geöffnete Musterpartie sieht
aus wie deine eigenen: mit Engine und Maia. Was fehlt, ist alles, was einen gespeicherten
Datensatz braucht: Analysedurchläufe, Notizen, angeheftete Varianten. **+ Zur Bibliothek
hinzufügen** speichert sie als fremde Partie. Sie bekommt dann den Analysedurchlauf und
nimmt Notizen an, zählt aber in keiner Statistik und taucht nicht in deinem Eröffnungsbaum
auf.

## Ein Repertoire aufbauen { #build-a-repertoire }

Das Repertoire besteht aus einem Baum für Weiß und einem für Schwarz, beide von dir
zusammengestellt. Spiel eine Variante auf dem Brett und drücke **Variante aufnehmen**; **Zur
Hauptvariante machen** und **Zweig löschen** formen den Baum, und zu jedem Zug kannst du
einen Kommentar schreiben, warum du ihn spielst. Die Seite steht noch nicht in der
Seitenleiste: öffne `/repertoire` direkt.
