# Explorer

## Deine eigenen Eröffnungen { #your-own-openings }

Der **Explorer** stellt ein Brett neben deinen Zugbaum. Spiel einen Zug, auf dem Brett oder
mit einem Klick auf seine Zeile, und die Tabelle zeigt, wie oft du diese Stellung hattest,
wie du abgeschnitten hast und welcher Zug dort dein schlechtester war. Den Zug, den du am
häufigsten spielst, zeigt sie fett. **Partien in dieser Variante** und **Deine Notizen zu
dieser Stellung** stehen daneben.

Über dem Brett stehen der Name der Eröffnung und die **Variante**: alle bisher gespielten
Züge, von **Start** bis zu dem Zug, auf dem du gerade stehst. Ein Klick auf einen dieser Züge
bringt dich zurück in diese Stellung. Unter dem Brett gehst du mit den Pfeiltasten (oder `←`
und `→`) in der Variante vor und zurück, **Drehen** stellt das Brett auf den Kopf, und
**Zurücksetzen** führt zurück zum Anfang.

Über der Tabelle legen zwei Umschalter fest, welches Buch du liest. **Partien aus** wählt
deine eigenen Partien, **Meister** oder **Lichess** (siehe
[unten](#the-lichess-reference-databases)), und **Farbe** zählt beide Farben, nur die
Partien mit Weiß oder nur die mit Schwarz.

Daneben grenzen Auswahlfelder ein, welche deiner Partien zählen. **Bedenkzeit** öffnet eine
Liste der Zeitkontrollen; nimm den Haken bei denen weg, die nicht zählen sollen, und das Feld
nennt danach die übrigen („Bedenkzeit: Blitz, Schnellschach“). **Datum** ist derselbe
Datumsfilter wie über deinen [Partien](games.md): zwei Datumsfelder und die Schnellwahl
Heute, 7T, 30T, 90T und 1J, jeweils von heute an zurückgerechnet. Mit **Heute** gehst du rasch
die Eröffnungen durch, die dir eben begegnet sind. Eine Schnellwahl trägt ihre Tage in die
Felder ein, sodass du von dort aus nachjustieren kannst, und ein Link auf „die letzten 30 Tage“
meint auch im nächsten Monat die letzten 30 Tage; getippte Daten bleiben, was du getippt
hast. **Leeren** oder das **×** am Auswahlfeld zählt wieder alle Partien.
Sobald du eine
[Sammlung](collections.md) hast, lässt **Sammlung** unter dem Datum nur die Partien einer
davon übrig; so hat auch eine Ligasaison ihren eigenen Eröffnungsbaum. Steht es auf **Alle Partien**, stehen die
Partien einer Sammlung im Baum wie jede andere. Der Baum, seine Buchvariante und die Partien darunter
richten sich nach alldem, und der Filter steht in der Adresse der Seite – ein gefilterter
Baum ist also ein Link.

Ist der Bereich schmal, lässt die Tabelle die Spalten **Eröffnung** und **Notiz** weg; zeig
mit der Maus auf eine Zeile, um sie zu lesen. **In Partien öffnen** neben **Partien in
dieser Variante** öffnet die Seite [Partien](games.md), gefiltert auf diese Eröffnung; deine
Farbe, eine einzelne Bedenkzeit, die Daten und die Sammlung nimmt sie mit.

In der Seitenleiste listet **Deine Varianten** unter **Explorer** die Eröffnungen, die du am
häufigsten erreichst, mit deinem Ergebnis in jeder. Ein Klick zeigt deine Partien in dieser
Eröffnung.

## Die Lichess-Referenzdatenbanken { #the-lichess-reference-databases }

Dasselbe Brett liest auch zwei Datenbanken von Lichess: **Meister**, Turnierpartien am Brett
zwischen Titelträgern, und die gewerteten **Lichess**-Partien, eingrenzbar mit dem
Auswahlfeld **Bedenkzeit** und den **Wertung**-Bereichen. Beides wird nicht gespeichert und
zählt nicht in deine eigenen Zahlen. **Farbe** bleibt stehen, ist aber ausgegraut: Eine Farbe
von dir haben nur deine eigenen Partien.

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
Datensatz braucht: Analysedurchläufe, Notizen, angeheftete Varianten. **Zur Bibliothek
hinzufügen** speichert sie als fremde Partie. Sie bekommt dann den Analysedurchlauf und
nimmt Notizen an, zählt aber in keiner Statistik und taucht nicht in deinem Eröffnungsbaum
auf.

## Ein Repertoire aufbauen { #build-a-repertoire }

Das Repertoire besteht aus einem Baum für Weiß und einem für Schwarz, beide von dir
zusammengestellt; der Umschalter **Weiß** / **Schwarz** neben dem Namen wählt, welchen du
siehst. Spielst du eine Variante auf dem Brett, wird sie gleich gespeichert; steht eine
Variante noch nicht im Baum, bietet die Seite **Variante aufnehmen** an. **Zur
Hauptvariante machen** und **Zweig löschen** (zweimal klicken) formen den Baum, und zu jedem
Zug kannst du einen Kommentar schreiben, warum du ihn spielst. Brett, **Variante** und
Pfeiltasten funktionieren wie im Explorer. Die Seite steht noch nicht in der
Seitenleiste: öffne `/repertoire` direkt.
