# Brett

## Was ist das Brett? { #what-is-the-board }

Ein Analysebrett. Du legst eine beliebige Stellung darauf, aus einer FEN, einer PGN oder der
Grundstellung, spielst Züge, gehst in ihnen vor und zurück und lässt eine Engine rechnen,
wo immer du gerade stehst. Die Engine kann auf einer anderen Maschine laufen, zum Beispiel
auf einem Remote Runner auf einem schnelleren Rechner (siehe
[Das Engine-Feld](#the-engine-panel)). Nichts, was du hier tust, ändert eine gespeicherte
Partie.

Auf demselben Brett zeigt dir auch dein KI-Assistent etwas. Ihr teilt es euch: Was einer von
euch hinlegt, sieht der andere, und der Assistent kann die Stellung auslesen, die du gerade
vor dir hast. **Brett drehen** dreht es nur für dich.

## Eine Stellung laden { #load-a-position }

**Laden…** öffnet ein Feld für eine FEN oder eine PGN. Füg eins von beiden ein; über dem
Feld steht, was erkannt wurde. Von einer PGN kommt die Hauptvariante aufs Brett, und das
Brett steht nach ihrem letzten Zug. Varianten und Kommentare der PGN bleiben draußen. Hat
die PGN einen `FEN`-Header, beginnt sie dort. Lässt sich der Text nicht lesen, steht der
Grund unter dem Feld, und das Feld bleibt offen, damit du nachbessern kannst.
**Ausgangsstellung** räumt das Brett und stellt die Grundstellung auf.

Das Feld brauchst du aber gar nicht: Hast du eine FEN oder eine PGN in der Zwischenablage,
drück ⌘V bzw. Strg+V irgendwo auf der Seite außerhalb eines Textfelds, und sie wird
sofort geladen.

**Zurücksetzen** räumt das Brett ganz ab, auch eine Reihe von Stellungen, die der Assistent
hingelegt hat.

## Ziehen und durch die Züge gehen { #play-and-step-through-moves }

Zieh eine Figur, um einen Zug zu spielen; ein Bauer auf der letzten Reihe wird zur Dame. Auf
einem leeren Brett beginnt der erste Zug in der Grundstellung.

Die Karte **Züge** zeigt die Hauptvariante, also die geladene Partie oder PGN, und
die Züge, die du davon abweichend gespielt hast, in Klammern hinter dem Zug, von dem sie
abzweigen. Klick einen Zug an, um das Brett dorthin zu stellen, oder geh mit ← und →
schrittweise. **Start** ist die Stellung, mit der die Zugfolge beginnt.

Wohin ein gespielter Zug kommt:

- Ist er der nächste Zug der Zugfolge, auf der du gerade stehst, geht das Brett einfach
  darauf weiter.
- Alles andere ist deine eigene Variante. Spielst du mitten in deiner Variante etwas
  anderes, ersetzt es den Rest der Variante ab dort.
- Es gibt immer nur eine Variante. Sie bleibt stehen, während du durch die Hauptvariante
  gehst, und wird ersetzt, sobald du woanders eine neue anfängst.

## Das Engine-Feld { #the-engine-panel }

Schalte das Feld ein, damit eine Engine die Stellung auf dem Brett durchrechnet und bei
jedem Zug weiterrechnet. Der Engine-Name ist eine Auswahl: Nimm jede Engine, die live rechnen
kann, auch eine auf einem [Remote Runner](../operate/runners.md#remote-runners). So denkt
ein schneller Rechner woanders, während du hier arbeitest. Die Zahl daneben legt fest, wie
viele Varianten angezeigt werden. Zeigst du auf eine Variante, erscheint ihr erster Zug als
Pfeil auf dem Brett; klickst du einen Zug darin an, wird die Variante bis zu diesem Zug
gespielt. Es funktioniert wie
[die Live-Engine in einer Partie](game.md#run-the-live-engine).

## Was der Assistent darauf legen kann { #what-the-assistant-can-put-on-it }

Bitte deinen Assistenten darum. `show_game` legt eine gespeicherte Partie aufs Brett, und
in der Karte **Züge** kannst du ihre Züge durchgehen. `show_position` legt eine FEN hin. Er
kann dabei Pfeile zeichnen, Felder einfärben und Züge spielen. Legt er mehrere Stellungen
auf einmal hin, gehst du mit **Zurück** und **Weiter** oben durch sie. Wie du überhaupt einen
Client verbindest, steht unter [Dein KI-Assistent](coach.md).

In der öffentlichen Demo gehört das Brett nur deinem Browser-Tab. Es wird mit niemandem
geteilt, und der Assistent kommt nicht heran.

## Das Feld „Trainer“ { #the-coach-panel }

Das Feld mit der Überschrift **Trainer** zeigt, was dein Assistent mit `annotate` schreibt,
während er es schreibt. Sonst schreibt dort niemand.

## Den Moment festhalten { #save-the-moment }

**Diesen Moment speichern** legt eine Notiz zur Stellung auf dem Brett an. Die Stellung
wird auf dem Server abgegriffen, zusammen mit der verfolgten Partie und einer eventuellen
Abweichung davon. Die Notiz hängt also an dem, was wirklich auf dem Brett lag, nicht an dem,
was dieser Tab zuletzt empfangen hat. Schreib auf, was du behalten willst, und drücke
**Notiz speichern**. Danach ist es eine gewöhnliche Notiz, siehe [Notizen](notes.md).

## Das Feld „Sitzung“ { #the-session-panel }

**Sitzung** nennt die verfolgte Partie oder die freie Stellung, ihre Quelle, Halbzug und
Zugrecht, den letzten Zug, wie viele Pfeile und Felder gezeichnet sind und ob das Brett die
Partie verlassen hat, mit der es begonnen hat.
