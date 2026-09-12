# Engines

Für die Analyse braucht es eine Engine. Engines sind Zeilen in der Datenbank, keine
Konfigurationsdateien: Du gibst einen Pfad an, Blunderbase startet die Datei, liest aus,
welche Optionen sie meldet, und behält die Zeile. Beim Start wird nichts aus einer Datei
gelesen, und nichts braucht einen Neustart.

Das Docker-Image bringt **Stockfish** unter `/usr/games/stockfish` mit; `stockfish` im
`PATH` führt zur selben Datei, und beide Schreibweisen funktionieren im Pfadfeld. **Maia**
ist in jedem Fall ein eigener Download.

## Die Engines-Seite { #the-engines-page }

**Rechenleistung → Engines** ist, was installiert ist, in zwei Teilen von oben nach unten.

*Was läuft womit*: je eine Zeile für Schnell, Tief und Menschliche Züge, mit der Engine,
die die Rolle hält, und, wenn sie nicht laufen kann, dem Grund in Worten.

**Engines**: jede eingerichtete Engine – ihre Art, die Maschine, auf der sie läuft, ihre
`Threads` und ihr `Hash`, welche Aufgaben sie hält und ob sie eingeschaltet ist. Ein Klick
auf eine Zeile öffnet die Karte der Engine. `Threads` und `Hash` stehen auf der Zeile, weil
sie sind, was ein *Prozess* der Engine kostet; wie viele Prozesse eine Maschine gleichzeitig
laufen lässt, wird nicht hier entschieden, sondern unter [Maschinen](runners.md), der Seite
daneben.

## Eine Engine hinzufügen { #adding-an-engine }

**Engine hinzufügen**, rechts oben auf der Engines-Seite, fragt drei Dinge. Eine Engine
über ihren Pfad ist immer die dieses Servers: Die Engines eines [Remote
Runners](runners.md) kommen aus dessen eigenem yaml, und die Engine in deinem Browser ist
eine Installation mit einem Klick unter Maschinen.

| Feld | Was hineingehört |
|---|---|
| Name | Deine Wahl. Eindeutig, und so heißt die Engine überall sonst |
| Pfad | Eine Datei, eine vollständige Kommandozeile mit Argumenten oder ein Name im `PATH` |
| Art | `uci` für eine Suchengine, `maia` für ein Modell menschlicher Züge |

Blunderbase fragt die Datei ab, bevor die Zeile gespeichert wird; ein falscher Pfad oder
eine Option, die die Engine nicht meldet, wird also jetzt abgelehnt und nicht erst bei der
Analyse. UCI-Optionen bearbeitest du auf der Karte der Engine unter **Mehr Einstellungen**,
geprüft gegen das, was die Datei gemeldet hat.

Die erste Engine ihrer Art, die registriert wird, übernimmt die Rollen, zu denen sie passt,
damit eine frische Installation ohne einen Besuch im Rollen-Formular funktioniert. Eine
bereits vergebene Rolle übernimmt sie nie.

## Die drei Rollen { #the-three-roles }

| Rolle | Was sie ausführt |
|---|---|
| Schnell | Den schnellen Durchlauf, den jede importierte Partie bekommt |
| Tief | Den langsameren Durchlauf mit mehreren Varianten, den du anforderst |
| Menschliche Züge | Maia – was ein Spieler deiner Wertung gezogen hätte |

Vergeben werden sie oben auf der Engines-Seite. **Es gibt keinen Ersatz.** Ist die Engine, die
eine Rolle hält, abgeschaltet, gelöscht oder auf einer Maschine, die nicht verbunden ist,
läuft diese Rolle nicht, und die App sagt, welche Engine und warum. Keine andere Engine
übernimmt stillschweigend.

Eine Installation ohne Maia verliert etwas, statt zu scheitern: Dir fehlen die Vorhersagen
menschlicher Züge, nicht die Bewertung.

Was jede Rolle kostet und wann sie läuft, steht unter [Analyse](../guide/analysis.md).

## Eine Engine testen { #testing-an-engine }

Öffne auf der Karte einer Engine **Mehr Einstellungen**.

- **Abfragen** liest die gemeldeten Optionen der Datei neu ein. Nimm das, nachdem die Engine
  aktualisiert wurde.
- **Testlauf** lässt diese Engine eine Stellung rechnen und zeigt, was zurückkam. Stell
  **Stellung**, **Knoten** und **Varianten** ein; eine Maia-Engine bietet stattdessen
  **Wertungen**.

Eine Engine, die ein Runner anbietet, ist hier nur lesbar, und ihr Testlauf wird abgelehnt,
statt zu starten, was *dieser* Host unter dem Pfad liegen hat. Maßgeblich ist die
Konfigurationsdatei des Runners.

## Kapazität { #capacity }

Wie viele Engine-Prozesse eine Maschine gleichzeitig laufen lässt, ist eine Eigenschaft der
Maschine, und sie steht unter [Maschinen](runners.md#how-much-at-once): die
**Warteschlangenprozesse** und **Suchplätze** dieses Servers, die Slots jedes Remote
Runners, und eine Bilanzzeile, die das gegen die Kerne aufrechnet, mit den `Threads`, die
jede Zeile hier verlangt. Diese Seite legt nur fest, was ein Prozess kostet.

## Eine Engine fürs Fernschach { #an-engine-for-correspondence }

Eine Fernschachsuche ist kein Auftrag aus der Warteschlange: Sie ist eine Engine, die
stunden- oder tagelang auf einer Stellung sitzt, und sie wird getrennt gezählt.
**Suchplätze** auf der Karte dieses Servers unter [Maschinen](runners.md#how-much-at-once)
legt fest, wie viele davon hier gleichzeitig laufen dürfen – voreingestellt zwei –, und es
sind eigene Plätze: Eine Suche nimmt nie den weg, auf den die Schnellanalyse einer
importierten Partie wartet. Gib dem Fernschach **eine eigene Engine-Zeile** statt der, die
deine Durchläufe benutzen: eine Zeile mit hohem `Threads` und so viel `Hash`, wie du
entbehren kannst, und wähl sie unter **Suchen mit …** an der Stellung. Ändern der Optionen
startet ohnehin einen frischen Prozess, die beiden Zeilen kommen sich also nie in die Quere.

Ein Suchplatz ist nicht dieselbe Einheit wie die **Warteschlangenprozesse** daneben, und
die beiden addieren sich, statt sich zu teilen: Diese Obergrenze sind die Engine-Prozesse
der *Warteschlange* über alle Stufen, **Suchplätze** begrenzt die Suchen daneben. Zwei
Plätze und sechs Warteschlangenprozesse sind bis zu acht Engine-Prozesse gleichzeitig auf
diesem Rechner; setz `Threads` in der Fernschach-Zeile also gegen das, was die Warteschlange
ohnehin schon belegt – die Bilanzzeile auf der Karte des Servers rechnet das vor und sagt,
wann die Maschine ins Schwimmen käme.

Zwei Dinge zum Speicher, bevor du `Hash` groß setzt. Eine **pausierte** Suche behält ihren
Prozess samt Hash, damit das Fortsetzen Sekunden statt Stunden kostet – die Kapazitätsleiste
der Fernschachseite sagt, wie viele geparkt sind und was jede hält, und Stoppen ist, was den
Speicher zurückgibt. Und **ein Neustart verliert jeden Hash**: Die Suchen kommen wieder, die
Bewertungen im Baum kommen wieder, aber jede Engine beginnt bei der Tiefe, die ihr letzter
Checkpoint festgehalten hat. Am Baum geht so oder so nichts verloren; das Ganze steht unter
[Fernschach](../guide/correspondence.md#pause-stop-and-what-survives).

Eine GPU-Engine wird genauso gezählt und teilt sich anders. Zwei Leela-Suchen gleichzeitig
sind zwei `lc0`-Prozesse auf einer Karte; sie teilen sich deren Speicher und deren Zeit,
jede ist also langsamer als eine allein, und eine Karte, die ein Netz bequem hält, hält
zwei vielleicht nicht. Verhindert wird es nicht – für eine lokale Engine gibt es keine
Grenze, wie viele Kopien laufen –, aber gedacht sind zwei Plätze für eine CPU-Engine und
eine GPU-Engine, jede auf ihrer eigenen Hardware.

**Aufgaben sind die andere Hälfte des Modus, und sie sind gewöhnliche
Warteschlangenarbeit.** Eine Aufgabe – ein begrenzter Blick auf eine Stellung, und das,
woraus eine [Erweiterung](../guide/correspondence.md#tasks-and-expansion) besteht – ist ein
`AnalysisRun` wie jeder andere: Sie belegt keinen Suchplatz, sie zählt zusammen mit der
Schnell- und der Tiefenanalyse gegen die **Warteschlangenprozesse**, und sie läuft auf
dem Host, dem die Warteschlange sie gibt – [Remote Runner](runners.md) eingeschlossen. Die
Engine, die du für eine Aufgabe wählst – in **Aufgabe einreihen …**, **Erweitern …** oder
**Teilbaum auffrischen …** –, darf also auf einem Runner liegen, und wo du einen Runner
hast, gehört sie dorthin: Die Aufgaben gehen auf die andere Maschine, und diese behält ihre
Kerne für die Suchen und die Durchläufe. Aufgaben stehen in der Warteschlange zwischen den Stufen, vor der
Schnellanalyse jeder importierten Partie und hinter einer Tiefenanalyse, auf die jemand
wartet, und untereinander gilt: die nächste Frist zuerst. **Warteschlange leeren** auf der
Analyseseite wirft die noch wartenden Aufgaben mit allem anderen hinaus, und jeder betroffene
Knoten sagt es.

Ideal ist eine eigene Maschine, und ein [Remote Runner](runners.md) ist der Weg dorthin:
Aufgaben werden ihm wie jeder Durchlauf zugeteilt, und eine Suche, die auf eine seiner
Engines gesetzt wird, läuft ebenfalls dort drüben und belegt einen seiner Slots. Nur ein
Runner, der über Polling verbunden ist, oder ein Browser-Tab nimmt keine Suche – seine
Verbindung trägt Warteschlangenarbeit und sonst nichts –, und die Auswahl sagt es. Gib dem
Runner dieselbe Sorgfalt wie einer lokalen Fernschach-Engine: eine Zeile in seiner
`runner.yaml` mit `Threads` und `Hash` für eine lange Suche bemessen, und Slots, bei denen
die Suchen mitgezählt sind.

## Die Engine im Browser { #the-engine-in-your-browser }

Wird eine Schnellanalyse, eine Tiefenanalyse oder die fortlaufende Analyse abgelehnt, weil
eine Rolle keine Engine hat, bietet der Partiebildschirm **Browser-Engine einrichten** an.
Das richtet diesen Browser als Runner ein, wartet, bis sein Stockfish registriert ist, gibt
ihm die Rolle, falls sie noch frei ist, und führt dann den Durchlauf aus, den du angefordert
hast. Du verlässt das Brett dabei nie.

Eine Browser-Engine will Cross-Origin-Isolation, um mit mehreren Threads zu laufen. Hinter
einem Proxy ist das [`BLUNDERBASE_CROSS_ORIGIN_ISOLATION`](deploy.md#settings-worth-knowing).

## Maia { #maia }

Maia ist ein Modell menschlicher Züge im Stil von lc0: Es antwortet mit dem, was ein Spieler
einer bestimmten Wertung tatsächlich ziehen würde, nicht mit dem Besten. Es ist bewusst
nicht mitgeliefert, denn es ist ein Python-Paket samt Gewichten, die heruntergeladen und
nicht paketiert werden.

So verwendest du es:

1. Installier einen Maia-Build auf der Maschine, die ihn ausführen soll. In einem Container
   mountest du ihn hinein.
2. Registrier ihn mit **Art** `maia` und im Pfadfeld mit der ganzen Kommandozeile –
   einschließlich des Verzeichnisses mit den Gewichten, damit er seinen Cache liest und nie
   ins Netz geht:

   ```
   /engines/maia3/bin/maia3-5m --use-uci-history --cache-dir /engines/maia3/models --local-files-only
   ```

3. Gib ihm die Rolle **Menschliche Züge**.

Die Wertung, nach der Maia gefragt wird, ist eine einzige Einstellung der Anwendung,
**Analyse → Maia**, und keine je Engine, damit nie nach zwei verschiedenen Spielern gefragt
wird. Sie ist auf 1100–2000 begrenzt, und eine Engine, die eigene Grenzen meldet, engt das
weiter ein.

Eine Maia steuert nie das Analysebrett – sie liefert eine Verteilung von Zügen, keine Suche.

## Von der Kommandozeile { #from-the-command-line }

Dasselbe ohne Browser, für eine Maschine ohne Bildschirm oder für ein Skript.

```console
$ blunderbase engines add sf-local stockfish --option Threads=4 --role quick --role deep
engine 'sf-local' Stockfish 18 registered: uci at stockfish
serves the quick tier, the deep tier
$ blunderbase engines list
$ blunderbase engines remove sf-local
```

`add` fragt die Datei genauso ab wie die Seite. `--replace` aktualisiert die Engine dieses
Namens, statt abzulehnen; damit lässt sich der Befehl gefahrlos erneut ausführen, und so
folgst du einer Datei, die umgezogen ist. `--role` nimmt eine Rolle dem weg, der sie hält;
ohne die Option werden nur freie Rollen besetzt. Eine Engine, die ein Runner anbietet, lässt
sich hier nicht ändern.

Alle Optionen stehen unter [Kommandozeile](cli.md#engines).

## Engines auf einer anderen Maschine { #engines-on-another-machine }

Eine Maschine mit freien Kernen kann Engines für diese Installation ausführen, ohne eine
zweite Installation zu sein. Siehe [Maschinen](runners.md).
