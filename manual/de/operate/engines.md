# Engines

Für die Analyse braucht es eine Engine. Engines sind Zeilen in der Datenbank, keine
Konfigurationsdateien: Du gibst einen Pfad an, Blunderbase startet die Datei, liest aus,
welche Optionen sie meldet, und behält die Zeile. Beim Start wird nichts aus einer Datei
gelesen, und nichts braucht einen Neustart.

Das Docker-Image bringt **Stockfish** unter `/usr/games/stockfish` mit; `stockfish` im
`PATH` führt zur selben Datei, und beide Schreibweisen funktionieren im Pfadfeld. **Maia**
ist in jedem Fall ein eigener Download.

## Die Engines-Seite { #the-engines-page }

Eine Seite in drei Teilen, von oben nach unten.

*Was läuft womit*: je eine Zeile für Schnell, Tief und Menschliche Züge, mit der Engine,
die die Rolle hält, und, wenn sie nicht laufen kann, dem Grund in Worten.

**Engine-Inventar**: jede eingerichtete Engine, was sie tut und wo sie läuft. Ein Klick auf
eine Zeile öffnet die Karte der Engine.

**Rechenkapazität**: dieser Server, dieser Browser und jeder [Remote Runner](runners.md),
jeweils mit den Engines, die er anbietet, und seinen Slots. Engines hinzufügen,
Browser-Stockfish installieren und Runner registrieren passiert alles hier.

## Eine Engine hinzufügen { #adding-an-engine }

Öffne unter **Rechenkapazität** auf der Karte dieses Servers **Engine hinzufügen** und trag
drei Dinge ein.

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

**Rechenkapazität** unten auf der Engines-Seite zeigt jeden Host, der Engine-Arbeit
übernehmen kann: diesen Server, diesen Browser, wenn du ihn als Runner eingerichtet hast,
und jeden Remote Runner mit der Anzahl Slots, die er anbietet. Ein Slot ist ein
Engine-Auftrag oder ein Analysebrett.

Auf dem Server selbst begrenzt `BLUNDERBASE_ANALYSIS_CONCURRENCY`, wie viele
Engine-Prozesse über alle Stufen hinweg gleichzeitig laufen. Voreingestellt sind die Kerne
der Maschine minus zwei. `BLUNDERBASE_ANALYSIS_WORKERS` schaltet die Worker im Prozess ganz
ab, für eine Installation, die die Warteschlange mit `blunderbase analyze` nach eigenem
Zeitplan abarbeitet. Siehe [Konfiguration](configuration.md).

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
zweite Installation zu sein. Siehe [Remote Runner](runners.md).
