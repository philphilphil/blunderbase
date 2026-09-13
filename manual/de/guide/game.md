# Eine Partie analysieren

## Durch die Partie gehen

← und → gehen einen Zug vor oder zurück, ↑ und ↓ springen zum vorigen und nächsten
markierten Zug, Pos1 und Ende an Anfang und Ende, die Leertaste spielt die Partie ab. `F`
dreht das Brett, `[` und `]` öffnen die vorige und die nächste Partie deiner Liste. Die
vollständige Tastenliste steht unter [Einstellungen](settings.md).

Die Leiste oben nennt die Eröffnung, die Herkunft der Partie, ihre Bedenkzeit und den
Ausgang. Bei einer Lichess- oder Chess.com-Partie ist der Quellen-Chip dort ein Link, der
die Partie auf der Seite in einem neuen Tab öffnet; auf dem Telefon ist derselbe Link der
Pfeil neben der PGN-Schaltfläche.

## Was die Markierungen bedeuten

Die Zugspalte kennzeichnet Züge mit `??`, `?`, `?!` oder `!` und färbt die betroffenen
Zeilen ein. Der Reiter **Markiert** neben **Züge** zeigt nur diese; `T` wechselt zwischen
beiden. Wann ein Zug welche Markierung bekommt, steht unter [Analyse](analysis.md).

## Der Bewertungsverlauf

Die Kurve unter dem Brett ist die Bewertung Zug für Zug; ein Klick darauf springt an die
Stelle. Form und Markierungen der Kurve sind Bretteinstellungen.

## Die Bedenkzeit je Zug { #see-how-long-each-move-took }

Wurde die Partie mit Uhr gespielt, hat das Feld einen zweiten Reiter, **Bedenkzeit**: eine
Säule je Zug, Weiß nach oben und Schwarz nach unten, so hoch, wie der Zug an Bedenkzeit
gekostet hat, mit denselben Markierungen für Fehler und grobe Fehler wie beim
Bewertungsverlauf. Eine feine Linie auf jeder Seite zeigt das Inkrement; eine Säule
darunter ist ein Zug, der Zeit gewonnen hat. Neben dem Diagramm stehen statt der
Genauigkeitswerte für jeden Spieler die durchschnittliche Bedenkzeit, die längste
Bedenkzeit und die Restzeit am Ende; zeigst du auf eine Säule, siehst du die Zugnummer,
die Bedenkzeit und die Restzeit danach. Ein Klick springt an die Stelle, wie beim
Bewertungsverlauf.

## Engine-Varianten und die Vorschau

Die Varianten unter dem Brett stammen aus der gespeicherten Analyse: eine nach einer
Schnellanalyse, mehrere nach einer Tiefenanalyse. Fahr mit der Maus über eine, und sie wird
auf dem Brett gezeigt, so wie du es unter **Variantenvorschau** eingestellt hast.

## Einen eigenen Zug ausprobieren

Spiel einen Zug auf dem Brett, und du bist in einer Variante; `Esc` bringt dich zur Partie
zurück. **Diese Variante anheften** speichert sie mit der Partie, sodass sie beim nächsten
Mal wieder da ist und im PGN-Export steht.

Du kannst die Züge auch tippen. `M`, oder die Tastatur-Schaltfläche neben **Hinweise**,
öffnet ein kleines Feld unter dem Brett: Tipp `Sf3`, `exd5`, `O-O` oder `e8=D` – oder
schlicht `g1f3` –, und der Zug wird gespielt, sobald er nur noch eines bedeuten kann; eine
ganze Variante geht so als eine Folge von Zügen hinein. Schlagzeichen, Schach und `=` sind
freiwillig, die englischen Figurenbuchstaben gehen genauso (`Nf3`), und ein Zug, den zwei
Figuren machen könnten (`Sd2` mit zwei Springern), wird als mehrdeutig gemeldet, bis du die
Linie dazuschreibst. `↵` spielt das Getippte, wenn das Feld noch auf mehr wartet, `Esc`
schließt es. Solange das Feld den Cursor hat, bewegen die Pfeiltasten den Cursor und nicht
die Partie.

## Die Engine live rechnen lassen

Das Engine-Feld hat zwei Reiter, **Analyse** und **Live**: was die gespeicherte Analyse
gefunden hat, und was eine Engine jetzt gerade findet. `E`, oder der Schalter rechts in
der Titelzeile des Felds, startet die Engine auf der aktuellen Stellung und wechselt auf
**Live**; dieselbe Taste oder derselbe Schalter hält sie an und wechselt zurück. Während
die Engine rechnet, kannst du auf **Analyse** klicken, um dir die gespeicherten Varianten
noch einmal anzusehen – der Punkt auf dem Reiter **Live** pulsiert weiter, bis du die
Suche anhältst.

Auf dem Reiter **Live** sind der Name der Engine und die Variantenzahl in der Titelzeile
Auswahlfelder: Klick auf den Namen, um die Engine zu wählen, auf die Zahl, um
einzustellen, wie viele Varianten sie zeigt. `↵` spielt ihren besten Zug aufs Brett.
Sobald du die Partie verlässt, wechselt das Feld von selbst auf **Live**, solange eine
Suche läuft – die gespeicherte Analyse hat die Stellung, in der du jetzt stehst, nie
gesehen.

## Was ein Mensch ziehen würde

Das Maia-Feld zeigt fünf Züge mit ihrer jeweiligen Wahrscheinlichkeit auf der gewählten
Spielstärke, nicht den besten Zug. Eine Variante gibt es dazu nicht; warum, steht unter
[Analyse](analysis.md).

## Eine Partie ohne Engine lesen { #read-a-game-without-the-engine }

`⇧E` oder der Computer in der Titelleiste nimmt jedes Engine-Urteil von diesem Bildschirm: den
Bewertungsbalken und die Bewertung, die `??`-Markierungen und die eingefärbten Zeilen, den
Verlauf, die Bereiche von Engine und Maia. Die Züge, die Uhren und deine Notizen bleiben,
und ebenso die Schaltflächen **Schnell** und **Tief**: Schreib erst auf, was deiner Meinung
nach schiefging, dann drück eine davon und sieh nach. Der Modus bleibt an, bis du ihn wieder
ausschaltest; alles dazu steht unter [Einstellungen](settings.md#hide-the-engine).

Eine Partie kann auch von selbst stumm ankommen: Ist unter
[Analyse](analysis.md#hide-the-engine-on-new-games) **Engine bei neuen Partien ausblenden**
an, wird jede neu importierte Partie analysiert, zeigt aber nichts davon, und in der Zeile
unter dem Brett steht eine Schaltfläche **Engine zeigen**. Lies die Partie, dann drück sie –
von da an spricht diese Partie, und die anderen bleiben unberührt.

## Eine Notiz schreiben

`N` öffnet eine Notiz zur Stellung auf dem Brett; **Enter** speichert sie, **Shift+Enter**
ist eine neue Zeile. Notizen erscheinen in jeder Partie, die diese Stellung erreicht – siehe
[Notizen](notes.md).

## Der Fernschachbaum { #the-correspondence-tree }

Eine Partie, die du im Fernschach gespielt hast, trägt in der Titelleiste die Schaltfläche
**Fernschachbaum**. Sie öffnet den Baum, der während der Partie entstanden ist – die
Zugkandidaten, die Kommentare und das, was die Engines zu jeder Stellung gesagt haben – zum
Lesen, nicht zum Ändern: Der Baum ist mit der Partie eingefroren. Die Schaltfläche gibt es
nur bei diesen Partien und nur, solange der Fernschachmodus an ist; der Modus steht unter
[Fernschach](correspondence.md).
