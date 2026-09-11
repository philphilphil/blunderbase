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

Vier Abschnitte, immer in dieser Reihenfolge, die drei Partielisten jeweils mit ihrer
Anzahl:

| Abschnitt | Enthält |
|---|---|
| **Du bist am Zug** | Partien, die auf dich warten, nächste Frist zuerst |
| **Warten auf den Gegner** | Dein Zug ist abgeschickt, es ist nichts zu tun |
| **Läuft gerade** | Jede Engine auf jeder Partie, eine Zeile je Suche – siehe [Läuft gerade](#running-now) |
| **Beendet** | Die letzten paar, jede ein Link auf die Partie in deiner Bibliothek |

Eine Zeile nennt beide Spieler und welche Farbe deine ist, das Turnier, Zugnummer und
letzten Zug, wie viele Tage dir bis zur Antwort bleiben – rot unter zwei, negativ, wenn du
zu spät bist – und die Bewertung der Stellung, in der die Partie steht, aus Weiß' Sicht,
welche Farbe du auch hast. Dazu ein Chip je Engine, die an dieser Partie arbeitet, mit der
Tiefe oder Knotenzahl, bei der sie steht – so sagt die Liste auf einen Blick, wohin die
Rechenzeit deines Rechners geht.

Unter der Überschrift steht die **Kapazitätsleiste**; in der Titelleiste stehen **Neue
Partie**, **PGN importieren** und **Alles pausieren**.

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
- Daneben sagt ein Knoten, was gerade mit ihm geschieht: ein **Spinner**, solange eine Engine
  auf ihm sitzt, eine **Warteschlangenmarke**, solange eine Aufgabe wartet, und eine
  **Veraltet-Marke**, wenn die gezeigte Zahl zu flach erreicht wurde oder von einer Engine
  stammt, die du nicht mehr hast – siehe [Aufgaben und Erweitern](#tasks-and-expansion).

Beide Zahlen stehen aus Sicht der Seite, die den Zug gemacht hat, so wie eine Variante
gelesen wird: `15.Ld3 +0,41` heißt, Weiß steht besser. Der Balken neben dem Brett und die
Spalte in der Liste stehen dagegen aus Weiß' Sicht, wie ein Bewertungsbalken immer.

Das Menü eines Knotens trägt die Verben:

| Verb | |
|---|---|
| **Suchen mit …** | Eine Engine auf diese Stellung ansetzen, siehe [Eine Stellung rechnen lassen](#search-a-position) |
| **Aufgabe einreihen** | Ein begrenzter Blick auf diese Stellung, über die Analysewarteschlange, siehe [Aufgaben und Erweitern](#tasks-and-expansion) |
| **Erweitern …** | Die besten Züge hier zu Kindern machen und unter jedes eine Aufgabe legen |
| **Teilbaum auffrischen** | Auf jeder veralteten Stellung von hier abwärts eine Aufgabe einreihen |
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

## Eine Stellung rechnen lassen { #search-a-position }

Die rechte Spalte sind die Engines: ein Feld je Engine, die den ausgewählten Knoten gerade
rechnet oder schon ein Urteil zu ihm hinterlassen hat, gestapelt untereinander.
**Suchen mit …** oben in der Spalte setzt eine weitere Engine auf die Stellung.

Zur Auswahl stehen die Engines, die du unter **Analyse → Fernschach → Such-Engines**
ausgewählt hast, in deiner Reihenfolge, die erste vorgeschlagen; hast du dort keine
ausgewählt, werden alle geeigneten angeboten – eingeschaltet, UCI, brettfähig und auf diesem
Rechner. Maia ist nie dabei: ein Blick ohne Suche ergibt eine Verteilung von Zügen, keine
Variante. Eine Engine auf einem [Remote Runner](../operate/runners.md) kann noch keine Suche
übernehmen, und eine Engine, deren Programmdatei verschwunden ist, wird mit Begründung
abgewiesen.

Unter dem Namen der Engine wird die Suche selbst eingestellt:

| | |
|---|---|
| **Varianten** | Wie viele Kandidatenvarianten behalten werden, 1 bis 5. Leer nimmt **Linien pro Suche** aus den Einstellungen |
| **Beenden bei** | Wo Schluss ist: einer **Tiefe**, einer Zahl **Knoten** oder einer Zahl **Sekunden**. **Nichts** – der gewöhnliche Fernschachfall und die Voreinstellung – heißt, die Suche läuft, bis du sie stoppst |

Ein erreichtes Limit beendet die Suche sauber: letzter Checkpoint geschrieben, Prozess
beendet, Platz zurückgegeben, und eine Meldung sagt, dass die Stellung fertig ist – auch
wenn du gerade eine andere Partie ansiehst.

**Nur die markierten Züge** im selben Dialog gibt der Engine eine Liste der Züge, die schon
unter diesem Knoten stehen, und sie sieht sich
nichts anderes an: die ganze Rechenzeit geht an die drei Kandidaten, um die es dir wirklich
geht. Das schränkt diese eine Suche ein und ändert nichts am Baum; die Züge müssen in der
Stellung legal sein. Ihre Zahlen bleiben im Feld und wandern nie in den Baum: der beste Zug
einer Auswahl ist nicht die Bewertung der Stellung, und gespeichert wäre er eine Zahl, die
keine spätere Suche mehr zurücknehmen könnte. Nimm sie, um schon gewählte Kandidaten zu
vergleichen, und eine uneingeschränkte Suche, wenn du das Urteil über die Stellung selbst
willst.

Eine Engine auf einem Knoten hat eine Suche: dieselbe Engine dort noch einmal anzusetzen,
solange sie eingereiht, laufend oder pausiert ist, wird abgewiesen – und eine beendete
Partie nimmt gar keine Suche mehr an, ihr Baum ist eingefroren.

Jede Suche belegt einen **Suchplatz** dieses Rechners – voreingestellt zwei, unter **Analyse
→ Fernschach → Suchplätze**. Sind alle belegt, wird die Suche **eingereiht** und startet von
selbst, sobald einer frei wird. Suchen haben eigene Plätze: eine, die drei Tage läuft, nimmt
also nie den Platz weg, auf den die Schnellanalyse einer importierten Partie wartet.

**Stockfish und Leela gleichzeitig** ist der Sinn des Stapels: zwei Engines auf derselben
Stellung, zwei Plätze, zwei laufende Felder, zwei Urteile zum Vergleichen. Stockfish liest
man an der Tiefe, Leela an der Knotenzahl – das Feld zeigt beides, denn Leela auf Tiefe 22
und Stockfish auf Tiefe 51 sind nicht dasselbe Maß. Zwei Leela-Suchen gleichzeitig sind zwei
Prozesse auf einer GPU, jeder dadurch langsamer; niemand hindert dich daran, und
[Engines](../operate/engines.md#an-engine-for-correspondence) sagt, was dabei abzuwägen ist.

Während sie rechnet, zeigt ein Feld Tiefe, Knoten, Geschwindigkeit und wie lange sie schon
läuft – gezählt ab dem letzten Start, eine nach einer Pause fortgesetzte Suche zeigt also
den laufenden Abschnitt und nicht die Tage, die sie geparkt stand –, dazu ihre
Kandidatenvarianten mit Bewertung, zweimal pro Sekunde aufgefrischt; zeigst du auf eine
Variante, wird sie aufs Brett gelegt. Rechnet sie nicht, behält das Feld, was
die Engine zuletzt gesagt hat: die gespeicherten Varianten, die erreichte Tiefe und eine
kleine Kurve, wie sich die Zahl im Lauf der Suche bewegt hat – ein Punkt bei jeder neuen
Tiefe, und bei einer Engine wie Leela, deren Tiefe stundenlang stillsteht, während die
Knotenzahl klettert, ein Punkt, sobald diese Zahl deutlich gewachsen ist. Daran erkennst du
eine Bewertung, die steht, und eine, die noch wandert.

Nichts wartet aufs Ende. Was die Engine findet, wird laufend in den Baum geschrieben, bei
jeder neuen Tiefe und mindestens einmal pro Minute; den Browser schließen, den Deckel
zuklappen oder den Server neu starten kostet dich also schlimmstenfalls die letzte Minute.
Ein Checkpoint bewegt eine Stellung außerdem immer nur vorwärts: ein kurzer Blick
überschreibt nie, was eine dreitägige Suche festgestellt hat.

Haben zwei Engines ein Urteil zu einem Knoten, liest der Baum das **tiefste** – es sei denn,
du **heftest** eines an: **Anheften** im Feld, und dieselbe Schaltfläche – sie liest sich
dann **Angeheftet** – gibt den Knoten zurück an das tiefste. Die Anheftung gilt je Knoten, du kannst Leela also genau in der Stellung glauben, in der du
sie für richtig hältst, ohne sonst etwas zu ändern. Das bernsteinfarbene **≠** an einem
Knoten ist der Hinweis, beide Felder zu lesen, bevor du einer der Zahlen traust.

## Aufgaben und Erweitern { #tasks-and-expansion }

Eine Suche ist eine Engine, die über eine Stellung nachdenkt, solange du sie lässt. Eine
**Aufgabe** ist die andere Hälfte: ein begrenzter Blick – voreingestellt vierzig Millionen
Knoten, ein bis zwei Minuten – auf eine Stellung, eingereiht in die gewöhnliche
Analysewarteschlange. Sie belegt keinen Suchplatz, steht einer Suche also nie im Weg, und
sie läuft dort, wo die Warteschlange Platz hat – auch auf einem
[entfernten Runner](../operate/runners.md). Welche Engine sie abarbeitet, legst du unter
**Analyse → Fernschach → Aufgaben-Engine** fest; wählst du keine, tut es die Engine mit der
Rolle Tiefenanalyse.

Das Menü eines Knotens trägt beides. **Aufgabe einreihen** bittet um einen Blick auf diese
Stellung. **Erweitern …** ist das, was die Arbeit eines Abends erledigt:

| | |
|---|---|
| **Breite** | Wie viele Züge jede Stufe behält – die ersten Züge der besten Varianten der Stellung, das stärkste zuerst. Leer nimmt **Linien pro Aufgabe** aus den Einstellungen |
| **Stufen** | Wie viele Ebenen tief, 1 bis 3. Breite 3 und 2 Stufen sind bis zu zwölf Stellungen, Breite 3 und 3 Stufen bis zu neununddreißig |
| **Aufgaben einreihen** | An bekommt jeder neue Zug eine Engine. Aus wandern die Züge in den Baum, und gerechnet wird nichts |

Erweiterst du einen Knoten, den die Engines schon beurteilt haben, entstehen die Kinder
sofort und unter jedem wartet eine Aufgabe; bei einem, den noch niemand angesehen hat,
entsteht eine einzige Aufgabe, die die ganze Erweiterung trägt und sie von selbst entfaltet,
sobald sie antwortet. So oder so kannst du den Browser schließen: Die Erweiterung steckt in
den eingereihten Zeilen und nicht in der Seite. **Erweitern …** über dem Baum tut dasselbe
für die Stellung, die du gewählt hast, ohne den Umweg über das Menü.

Aufgaben stehen in der Warteschlange vor der automatischen Analyse jeder importierten Partie
und hinter einer Tiefenanalyse, auf die du gerade wartest, und untereinander gilt: **die
nächste Frist zuerst**. Eine Partie, die morgen fällig ist, kommt vor einer, die nächste
Woche fällig ist – gleich in welcher Reihenfolge sie eingereiht wurden. Ein Knoten, auf dem
eine Aufgabe wartet, trägt eine Warteschlangenmarke; einer, an dem gerechnet wird, einen
Spinner. **Abbrechen** nimmt eine wartende Aufgabe wieder heraus; eine, die eine Engine
schon begonnen hat, läuft zu Ende. **Warteschlange leeren** auf der Seite
[Analyse](analysis.md#what-is-left-to-analyse) leert sie auch von Aufgaben, und jeder
Knoten, dessen Aufgabe mit hinausging, sagt, warum sie gestoppt wurde. Verschwindet die
Maschine mitten in der Rechnung – der Prozess abgeschossen, ein entfernter Rechner
abgesteckt –, geht die Aufgabe von selbst zurück in die Warteschlange und wird noch einmal
versucht; klappt auch das nicht, wird der Knoten als fehlgeschlagen markiert, trägt den
Grund und ist wieder frei für eine neue Aufgabe.

Deine **Markierungen** steuern das Ganze – der Grund, sie zu setzen:

| Markierung | Was eine Erweiterung damit macht |
|---|---|
| **✕ Ausgeschlossen** | Wird nie erweitert, bekommt nie eine Aufgabe, und alles darunter wird ebenfalls übersprungen |
| **? Schlecht** | Höchstens eine Stufe, wie tief die Erweiterung ringsum auch geht |
| **! Gut**, **!? Interessant** | Eine Stufe mehr und ein Geschwisterzug mehr als die Nachbarn |
| Keine Markierung | Die Breite und die Stufen, um die du gebeten hast |

**Teilbaum auffrischen** im selben Menü ist das Wartungsverb. Ein Urteil ist **veraltet**,
wenn es flacher ist als **Veraltet unter Tiefe** – voreingestellt dreißig – oder wenn es von
einer Version der Engine stammt, die nicht mehr installiert ist. Das ist das, was man
vergisst: Ein im Januar aktualisiertes Stockfish macht jedes Urteil vom Dezember zu dem
eines anderen. Veraltete Urteile sind im Baum markiert, und **Teilbaum auffrischen** reiht
auf jeder veralteten Stellung von diesem Knoten abwärts eine Aufgabe ein, Lücken im Ast
eingeschlossen. Sind es mehr als fünfzig, wird es abgelehnt und sagt, wie viele es sind:
dann lieber Ast für Ast als den ganzen Baum einer Partie auf einmal.

## Pausieren, stoppen und was überlebt { #pause-stop-and-what-survives }

Jedes Feld trägt **Pause** und **Stopp**, und das ist nicht dasselbe:

| | |
|---|---|
| **Pause** | Der Platz ist sofort zurück, der Prozess bleibt. Er wird mit intaktem Hash geparkt, **Fortsetzen** – es nimmt den nächsten freien Platz – macht also in Sekunden weiter statt in Stunden. Eine geparkte Engine kostet den Speicher ihres `Hash` und keine CPU |
| **Stopp** | Die Suche endet und der Prozess wird beendet. Der Speicher kommt zurück, die Zeile ist abgeschlossen: Eine gestoppte Suche wird nicht fortgesetzt, du startest eine neue, und die beginnt kalt |

Die Pause wirkt sofort; *geparkt, warm* sagt das Feld einen Moment später, wenn die Engine
wirklich beiseitegelegt ist. Die Kapazitätsleiste zählt, was geparkt ist und wie viel es
hält – daran entscheidest du, wann geparkt zu viel ist.

Ein **Neustart** – des Servers, des Containers, der Maschine – ist der dritte Fall. Suchen,
die liefen, starten von selbst wieder, sobald der Server oben ist, sofern ihre Engine noch
eingerichtet ist; der Rest kommt pausiert zurück, mit dem Grund in der Zeile. Kein Prozess
überlebt einen Neustart, jede Suche ist danach also kalt – ein Feld, das *pausiert, kalt*
statt *geparkt, warm* meldet, ist eines, dessen Prozess es nicht mehr gibt: Die Engine
beginnt bei der Tiefe
ihres letzten Checkpoints und braucht bis zur alten Tiefe ungefähr so lange wie beim ersten
Mal, weil die letzten Iterationen die Zeit fressen.

Was alle drei Fälle immer überlebt, ist der Baum – Bewertung, Tiefe, Knotenzahl, Varianten
und Verlauf an jedem Knoten, so weit sie gekommen waren. Eine Pause behält die Hashtabelle
der Engine, ein Stopp und ein Neustart verlieren sie. Das ist Zeit, kein Wissen.

Eine Suche, die scheitert – eine verschwundene Programmdatei, eine mitten im Rechnen
gestorbene Engine –, wird als gescheitert markiert und behält ihren Fehler im Feld. Der Baum
behält jeden Checkpoint, den sie bis dahin gesetzt hat.

## Läuft gerade { #running-now }

Zurück auf der Liste, zwischen **Warten auf den Gegner** und **Beendet**, steht jede Engine
auf jeder Partie, eine Karte je Suche: die Engine und der Rechner, auf dem sie läuft, die
Partie, für die sie arbeitet, die Bewertung, bei der sie steht, Tiefe und Knotenzahl und wie
lange sie schon läuft. Eine geparkte Suche steht ebenfalls in der Liste, blass und mit dem
Vermerk warm, und eine, die auf einen Platz wartet, auch. Jede Karte ist ein Link in die
Partie, zu der sie gehört.

**Auch Aufgaben stehen in der Liste**, mit dem Vermerk `Aufgabe`: eine Karte je Aufgabe, die
wartet oder an der gerechnet wird, mit der Engine, dem Rechner, auf dem diese Engine lebt,
und dem Knotenbudget, mit dem sie eingereiht wurde. Eine Aufgabe meldet nichts, solange sie
wartet, trägt also keine Tiefe – was sie über ihre Größe sagen kann, ist das, was sie
ausgeben wird.

Die **Kapazitätsleiste** unter der Seitenüberschrift zählt dieselbe Arbeit über die ganze
Installation: belegte Suchplätze von denen, die dieser Rechner hat, Suchen, die auf einen
warten, warm geparkte Engines und der Speicher, den sie halten, wie viele Aufgaben unterwegs
sind und an wie vielen davon schon gerechnet wird, und eine Zeile je entferntem
Rechner. Aufgaben werden neben den Plätzen gezählt und nicht gegen sie: Sie belegen keinen. Dieselben Zahlen stehen am Fuß der Seitenleiste, damit sie von jedem Bildschirm aus
beantwortet sind. Leiste und Liste folgen den Suchen, wie sie melden – hier gibt es nichts
nachzuladen.

## Alles pausieren { #pause-all }

**Alles pausieren** in der Titelleiste ist für den Moment, in dem der Laptop zugeht oder die
Maschine für etwas anderes gebraucht wird. Es pausiert jede Suche in jeder Partie, warm,
genau wie das Pausieren einer einzelnen, und wird zu **Alle fortsetzen**, das sie alle wieder
in Gang setzt: Jede nimmt einen Platz, sobald einer frei wird. Eine pausierte Suche, deren
Engine inzwischen ausgeschaltet oder entfernt wurde, bleibt pausiert und sagt es.

Beides zerstört nichts. Der Baum behält, was jede Suche als Checkpoint gesetzt hat, und
Suchen, die fortgesetzt werden, während ihre Prozesse noch geparkt sind, kommen bei der
Tiefe zurück, bei der sie aufgehört haben.

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
  noch ändern, und er nimmt weder eine neue Suche noch eine neue Aufgabe mehr an.
- Eine Suche, die noch auf der Partie läuft, wird dir nicht abgenommen – es ist deine
  Rechenzeit. **Stopp** in ihrem Feld beendet sie, wenn die Partie vorbei ist.

Ab da ist es eine Partie wie jede andere: im Bewertungsverlauf, unter **Partien** bei ihrer
Quelle und der Bedenkzeit Fernschach, und in den Statistiken. Ihre Partieseite behält in der
Titelleiste die Schaltfläche **Fernschachbaum**, die den eingefrorenen Baum neben der
beendeten Partie öffnet – siehe [Eine Partie analysieren](game.md#the-correspondence-tree).
