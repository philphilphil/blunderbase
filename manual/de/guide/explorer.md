# Explorer

## Deine eigenen Eröffnungen

Der **Explorer** stellt ein Brett neben deinen Zugbaum. Spiel einen Zug, und die Tabelle
zeigt, wie oft du diese Stellung hattest, wie du abgeschnitten hast und welcher Zug dort
dein schlechtester war. `←` und `→` gehen die Variante entlang. **Partien in dieser
Variante** und **Deine Notizen zu dieser Stellung** stehen daneben.

## Die Lichess-Referenzdatenbanken

Dasselbe Brett liest auch zwei Datenbanken von Lichess: **Meister**, Turnierpartien am Brett
zwischen Titelträgern, und die gewerteten Lichess-Partien, eingrenzbar nach Bedenkzeit und
Wertungsbereich. Beides wird nicht gespeichert und zählt nicht in deine eigenen Zahlen.

## Ein Lichess-Token hinterlegen

Beide Referenzdatenbanken brauchen ein persönliches API-Token von Lichess. Erzeuge eines
unter <https://lichess.org/account/oauth/token>, **ohne einen Berechtigungsumfang
anzuhaken**, und trag es dort ein, wo die Referenzquellen danach fragen. Ohne Token liefern
sie eine Fehlermeldung statt einer leeren Liste. Ein leeres Feld löscht das gespeicherte
Token.

## Eine Musterpartie öffnen { #open-a-model-game }

**Musterpartien** listet Partien aus diesen Datenbanken. Eine geöffnete Musterpartie sieht
aus wie deine eigenen: mit Engine und Maia. Was fehlt, ist alles, was einen gespeicherten
Datensatz braucht: Analysedurchläufe, Notizen, angeheftete Varianten. **+ Zur Bibliothek
hinzufügen** speichert sie als fremde Partie. Sie bekommt dann eine Schnellanalyse und
nimmt Notizen an, zählt aber in keiner Statistik und taucht nicht in deinem Eröffnungsbaum
auf.

## Ein Repertoire aufbauen { #build-a-repertoire }

Das Repertoire besteht aus einem Baum für Weiß und einem für Schwarz, beide von dir
zusammengestellt. Spiel eine Variante auf dem Brett und drücke **Variante aufnehmen**; **Zur
Hauptvariante machen** und **Zweig löschen** formen den Baum, und zu jedem Zug kannst du
einen Kommentar schreiben, warum du ihn spielst. Die Seite steht noch nicht in der
Seitenleiste: öffne `/repertoire` direkt.
