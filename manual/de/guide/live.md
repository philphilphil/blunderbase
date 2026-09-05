# Live

## Was ist das Live-Brett?

Ein Brett, das die App selbst nicht bewegt. **Live** zeigt, was ein MCP-Client darauf gelegt
hat, damit du und der Assistent, der deine Bibliothek liest, über dieselbe Stellung
sprecht. Solange nichts darauf liegt, ist es leer; läuft eine Sitzung, steht in der
Seitenleiste **läuft**. **Brett drehen** dreht es nur für dich.

## Etwas aufs Brett legen

Bitte deinen Assistenten darum. `show_game` legt eine gespeicherte Partie aufs Brett,
`show_position` eine FEN. Er kann dabei Pfeile zeichnen, Felder einfärben und die Partie
Zug für Zug weiterschalten. Wie du überhaupt einen Client verbindest, steht unter
[Dein KI-Assistent](coach.md).

## Das Feld „Trainer“

Das Feld mit der Überschrift **Trainer** zeigt, was dein Assistent mit `annotate` schreibt,
während er es schreibt. Sonst schreibt dort niemand.

## Den Moment festhalten

**Diesen Moment speichern** legt eine Notiz zur Stellung auf dem Brett an. Die Stellung
wird auf dem Server abgegriffen, zusammen mit der verfolgten Partie und einer eventuellen
Abweichung davon. Die Notiz hängt also an dem, was wirklich auf dem Brett lag, nicht an dem,
was dieser Tab zuletzt empfangen hat. Schreib auf, was du behalten willst, und drücke
**Notiz speichern**. Danach ist es eine gewöhnliche Notiz, siehe [Notizen](notes.md).

## Das Feld „Sitzung“

**Sitzung** nennt die verfolgte Partie oder die freie Stellung, ihre Quelle, Halbzug und
Zugrecht, den letzten Zug, wie viele Pfeile und Felder gezeichnet sind und ob das Brett die
Partie verlassen hat, mit der es begonnen hat.
