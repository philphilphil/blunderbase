# Fernschach

Alles andere in Blunderbase ist die Aufzeichnung einer gespielten Partie. **Fernschach** ist
die, die gerade gespielt wird: ein Zug alle paar Tage, über Monate, auf dem ICCF-Server oder
überall sonst, wo man so viel Zeit bekommt. Die Arbeit steckt nicht in der Zugliste, sondern
im Baum der Kandidatenzüge dahinter – und den hält dieser Bildschirm fest.

Der Modus ist aus, bis du ihn unter **Analyse → Fernschach** einschaltest, siehe
[Analyse](analysis.md#correspondence). Ist er an, steht **Fernschach** in der Seitenleiste
unter **Live**; ist er aus, gibt es den Eintrag nicht und die Seiten schicken dich zur
Übersicht zurück.

## Die Liste { #the-list }

Drei Abschnitte, immer in dieser Reihenfolge, jeder mit seiner Anzahl:

| Abschnitt | Enthält |
|---|---|
| **Du bist am Zug** | Partien, die auf dich warten, nächste Frist zuerst |
| **Warten auf den Gegner** | Dein Zug ist abgeschickt, es ist nichts zu tun |
| **Beendet** | Die letzten paar, jede ein Link auf die Partie in deiner Bibliothek |

Eine Zeile nennt beide Spieler und welche Farbe deine ist, das Turnier, Zugnummer und
letzten Zug, wie viele Tage dir bis zur Antwort bleiben – rot unter zwei, negativ, wenn du
zu spät bist – und die Bewertung der Stellung, in der die Partie steht, aus Weiß' Sicht,
welche Farbe du auch hast. In der Titelleiste stehen **Neue Partie** und
**PGN importieren**.

## Eine Partie anlegen { #start-a-game }

**Neue Partie** fragt ab, was eine Fernschachpartie ausmacht:

| Feld | |
|---|---|
| **Weiß**, **Schwarz** | Die Namen, so geschrieben wie auf dem Server |
| **Du spielst** | Weiß oder Schwarz. Pflichtangabe: Zugrecht und alle Fristen werden davon aus gerechnet |
| **Turnier** | Das Turnier, es landet im PGN-Header `Event` |
| **Link** | Die Partieseite auf dem Server, gespeichert als `Site` |
| **ICCF-Nummer** | Die Partienummer. Mit ihr ist die Quelle der Partie **ICCF** und die Nummer identifiziert sie; ohne sie ist es eine manuelle Partie und sonst dasselbe |
| **Bedenkzeit** | Freier Text, wie das Turnier sie angibt: `10 Tage/Zug`, `40 Tage/10 Züge` |
| **Startstellung** | Eine FEN, für ein Thematurnier. Leer ist die gewöhnliche Grundstellung |
| **Tage pro Zug** | Das Antwortfenster dieser Partie. Leer nimmt die Voreinstellung aus den Einstellungen |
| **Antwort fällig** | Wann dein nächster Zug fällig ist, falls du es schon weißt. Leer gelassen, bekommt eine Partie, in der du am Zug beginnst, eine Frist von heute plus Tage pro Zug |

**PGN importieren** nimmt den Text, den der Server exportiert – eingefügt in das Feld –, und
füllt dieselben Felder aus den Headern: die Züge werden die gespielte Linie, `Event` und `Site`
kommen aus dem PGN, solange du sie nicht überschreibst, und wenn du am Zug bist, bekommst du
eine Frist aus Tage pro Zug. Für eine laufende Partie ist das der schnellere Weg.

Eine Partie, die die Bibliothek schon hat, wird abgewiesen statt doppelt gespeichert –
dieselbe ICCF-Nummer, oder dieselben zwei Namen am selben Tag mit denselben Zügen.

## Die Züge eintragen { #enter-the-moves }

Zwei Schaltflächen in der Kopfzeile bewegen die Partie, beide um genau einen Zug:

- **Gegner hat gezogen…** trägt den Zug ein, der angekommen ist.
- **Diesen Zug spielen** nimmt den Zug, den du im Baum ausgewählt hast, und das ist dein
  Zug. Hier wird er aufs Brett gelegt; abgeschickt wird er weiterhin dort, wo die Partie
  läuft.

Sobald du am Zug bist, wird die Frist auf jetzt plus Tage pro Zug gesetzt; solange der
Gegner denkt, gibt es keine. Die Frist selbst lässt sich in der Kopfzeile ändern; Tage pro
Zug steht mit dem Anlegen der Partie fest – änderst du die Voreinstellung in den
Einstellungen später, bleiben laufende Partien also, wie sie sind.

**Letzten Zug zurücknehmen** macht einen versehentlich eingetragenen Zug rückgängig. Der Zug
bleibt im Baum, mit seinen Kommentaren und allem, was darunter analysiert wurde; er gehört
nur nicht mehr zur gespielten Linie.

## Der Baum { #the-tree }

Die mittlere Spalte, und der Sinn des Bildschirms. Die gespielten Züge sind das Rückgrat;
jeder andere eingetragene Zug hängt eingerückt unter dem Zug, den er beantwortet. Spiel
einen Zug auf dem Brett, und er kommt in den Baum: gibt es den Ast schon, gehst du hinein,
gibt es ihn nicht, wird er angelegt. Die Pfeiltasten laufen durch den Baum – links und
rechts an einer Linie entlang, hoch und runter durch die Alternativen.

Jeder Knoten zeigt seinen Zug, seine Bewertung und die Bewertung, die seine eigenen Äste
zurückgeben:

- **Eigen** ist das, was eine Engine über diese Stellung sagt.
- **Gestützt** ist das, was dein Baum wirklich belegen kann: das Minimax über die Kinder, die
  eine Zahl haben. Weichen beide voneinander ab, zeigt der Knoten beide und einen Pfeil, der
  die Richtung nennt – dieser Abstand ist der ganze Grund, einen Baum zu führen. Eine eigene
  Bewertung über der gestützten heißt genau das: der erste Vorschlag der Engine ist vier
  Züge tiefer widerlegt.
- Ein bernsteinfarbenes **≠** sagt, dass zwei Engines in dieser Stellung mehr als einen
  halben Bauern auseinanderliegen – die Zahl darunter ist also weniger wert, als sie aussieht.

Beide Zahlen stehen aus Sicht der Seite, die den Zug gemacht hat, so wie eine Variante
gelesen wird: `15.Ld3 +0,41` heißt, Weiß steht besser. Der Balken neben dem Brett und die
Spalte in der Liste stehen dagegen aus Weiß' Sicht, wie ein Bewertungsbalken immer.

Das Menü eines Knotens trägt die Verben:

| Verb | |
|---|---|
| **Kommentieren** | Deine Anmerkung zum Zug; sie geht als Kommentar ins PGN |
| **Markieren** | Dein Urteil über den Zug, siehe unten |
| **Nach vorn holen** | Diesen Zug zur ersten seiner Alternativen machen, damit er als Hauptzug gelesen wird |
| **Teilbaum löschen** | Diesen Zug und alles darunter vergessen. Die Wurzel und ein tatsächlich gespielter Zug lassen sich nicht löschen |

Markierungen sind dein Wort, nicht das der Engine, und jede hat ihr Zeichen:

| Markierung | Zeichen |
|---|---|
| Gut | `!` |
| Interessant | `!?` |
| Fragwürdig | `?!` |
| Schlecht | `?` |
| Ausgeschlossen | `✕` |

Linien, die die Partie verlassen hat – die Alternativen zu einem Zug, den der Gegner nicht
gespielt hat –, werden ausgegraut und nicht entfernt. Sie kosten nichts und sind der Beleg
dafür, was du dir angesehen hast; **Teilbaum löschen** steht bereit, wenn ein Ast wirklich
erledigt ist.

**PGN exportieren** schreibt den ganzen Baum heraus: die gespielte Linie als Hauptvariante,
jeden anderen Knoten als Variante unter dem Zug, den er beantwortet, deine Kommentare als
Kommentare, deine Markierungen als NAGs und die Bewertung jedes Knotens als
`{[%eval 0.25]}` – in der Schreibweise von Lichess, damit jedes Programm, das sie kennt, die
Zahlen anzeigt. Eine Startstellung bleibt als `FEN`-Header erhalten.

Auf diesem Bildschirm startet noch keine Engine. Eine Stellung rechnen lassen, die
Engine-Felder neben dem Baum, das Anhalten und was ein Neustart überlebt, kommen mit dem
nächsten Schritt und bekommen dann eine eigene Überschrift in diesem Kapitel.

## Notizen und das Buch { #notes-and-the-book }

Unten rechts drei Reiter zum ausgewählten Knoten:

- **Diese Stellung** – Notizen, an die Stellung des ausgewählten Knotens geheftet. Sie
  tauchen damit in jeder deiner Partien wieder auf, die diese Stellung erreicht, und im
  Explorer. Der **Kommentar** zum Zug – die Bemerkung, die ins exportierte PGN wandert –
  wird darüber bearbeitet.
- **Diese Partie** – das Journal: was der Gegner gern tut, der Plan, die Rechnerei mit den
  Fristen. An die Partie geheftet und an keinen Zug.
- **Buch** – was über diese Stellung schon bekannt ist, aus zwei Büchern: **Meister**,
  dieselbe Datenbank wie die Referenzquelle im [Explorer](explorer.md), wofür der dort
  hinterlegte Lichess-Token nötig ist, und **Deine Partien**, dein eigener Baum aus dieser
  Stellung. Zeigst du auf eine Zeile, wird sie aufs Brett gelegt; klickst du sie an, wandert
  der Zug in den Baum – in den vorhandenen Zweig hinein, wenn es ihn gibt, sonst wird er
  angelegt. So wird hier die Eröffnungsphase gespielt: Theorie lesen und das Gelesene
  behalten, in einem Klick.

Die ersten beiden sind die Notizen aus [Notizen](notes.md), geschrieben mit demselben Editor.
Notizen lassen sich auch zu einer beendeten Partie noch schreiben; der Zugkommentar nicht –
er gehört zum eingefrorenen Baum, und eine beendete Partie zeigt ihn nur noch als Text.

## Eine Partie abschließen { #finish-a-game }

**Beenden…** fragt nach dem Ergebnis – `1-0`, `0-1` oder `½-½` – und, wenn du magst, wie die
Partie ausging (Aufgabe, Schiedsspruch, Zeit). Danach:

- Schnell- und Tiefenanalyse werden über die Partie eingereiht, wie bei jeder ankommenden
  Partie. Ist für eine Rolle keine Engine eingerichtet, wird dafür nichts eingereiht und die
  Meldung sagt es; die Partie ist trotzdem beendet, und den Durchlauf kannst du später
  nachholen.
- Die Frist wird gelöscht und die Partie verlässt **Du bist am Zug**.
- Der Baum friert ein. Er bleibt bei der Partie und lesbar, aber nichts darin lässt sich
  noch ändern.

Ab da ist es eine Partie wie jede andere: im Bewertungsverlauf, unter **Partien** bei ihrer
Quelle und der Bedenkzeit Fernschach, und in den Statistiken. Ihre Partieseite behält in der
Titelleiste die Schaltfläche **Fernschachbaum**, die den eingefrorenen Baum neben der
beendeten Partie öffnet – siehe [Eine Partie analysieren](game.md#the-correspondence-tree).
