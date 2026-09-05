# Sichern und wiederherstellen

Unter **Bibliothek → Verwalten** liegen zwei verschiedene Dinge, und keines ersetzt das
andere.

| | PGN-Export | Datenbanksicherung |
|---|---|---|
| Was es ist | Eine portable Kopie für andere Schachsoftware | Eine verlustfreie Kopie der ganzen Installation |
| Enthält | Partien, die ursprünglichen Header, Kommentare und Varianten. Notizen aus Blunderbase werden Kommentare, gespeicherte Varianten werden Varianten | Partien, Anmerkungen, Analysen, Konten, Einstellungen, Zugangsdaten und die Engine-Konfiguration |
| Verliert | Engine-Bewertungen, Konten, Analyse-Einstellungen, den gemerkten Importstand | Nichts |
| Wiederherstellen | Indem du die Datei irgendwo importierst | Nur über die Kommandozeile, bei gestopptem Blunderbase |

## PGN exportieren { #export-pgn }

**Bibliothek → Verwalten → PGN exportieren** lädt jede gespeicherte Partie in einer Datei
`blunderbase-library.pgn` herunter.

Das ist die Kopie, die du einem anderen Programm gibst. Eine Sicherung der Anwendung ist
sie nicht.

## Eine Sicherung herunterladen { #download-a-backup }

**Bibliothek → Verwalten → Sicherung herunterladen** erstellt die verlustfreie,
integritätsgeprüfte Kopie der SQLite-Datei. Der Download erscheint, sobald Blunderbase
einen konsistenten Schnappschuss vorbereitet hat.

Du darfst eine Sicherung ziehen, während Blunderbase läuft. Die Online-Backup-Schnittstelle
von SQLite nimmt alle festgeschriebenen Write-Ahead-Log-Transaktionen in einen konsistenten
Schnappschuss auf.

**Bewahr sie auf wie ein Passwort.** Passwörter und API-Schlüssel liegen als Hash statt im
Klartext darin, die Datei bleibt trotzdem privat.

Dasselbe von der Shell aus:

```bash
blunderbase db backup /safe/place/blunderbase-2026-09-01.db
```

Sicherung und Wiederherstellung führen beide die vollständige Integritätsprüfung von SQLite
aus, verlangen eine Blunderbase-Schemarevision und geben die Zahl der Bytes, die Revision
und einen SHA-256 aus. **Die beiden SHA-256-Werte müssen übereinstimmen.**

`--force` ersetzt eine schon vorhandene Ausgabedatei.

## Wiederherstellen { #restore }

Das Wiederherstellen tauscht die Datenbank unter dem laufenden Prozess aus und ist in der
Web-App deshalb bewusst nicht vorgesehen. Es ist eine Sache der Kommandozeile, bei
gestopptem Blunderbase.

Stopp zuerst jeden Prozess, der diese Datenbank benutzt. Dann auf der Installation, die sie
übernimmt:

```bash
blunderbase db restore /safe/place/blunderbase-2026-09-01.db --force
blunderbase db upgrade
```

Die Wiederherstellung prüft die Eingabe, *bevor* sie die konfigurierte Datenbank anfasst,
setzt sie per atomarem Rename ein und weigert sich, eine vorhandene Datenbank ohne
`--force` zu ersetzen.

`db upgrade` bringt eine ältere Sicherung auf das aktuelle Schema. Der Befehl ist beim
Wiederherstellen eines älteren Release sicher und tut auf der aktuellen Revision nichts.

Starte Blunderbase und prüf die Zahl auf dem Bibliotheks-Bildschirm.

## Mit Docker { #with-docker }

Kopier die geprüfte Sicherung aus dem benannten Volume heraus, statt die einzige Kopie
neben der laufenden Datenbank liegen zu lassen.

```bash
docker exec blunderbase blunderbase db backup /data/blunderbase-backup.db
docker cp blunderbase:/data/blunderbase-backup.db ./blunderbase-backup.db
```

Um sie wiederherzustellen:

```bash
docker compose stop blunderbase
docker cp ./blunderbase-backup.db blunderbase:/data/restore.db
docker compose run --rm --no-deps \
  --entrypoint blunderbase blunderbase db restore /data/restore.db --force
docker compose up -d blunderbase
```

Der Container führt beim Start `db upgrade` aus, der letzte Befehl erledigt die Migration
also mit.

## Was in beidem nicht steckt { #what-is-not-in-either }

Nichts über die Engines auf anderen Rechnern. Ein [Runner](runners.md) wird auf seinem
eigenen Rechner durch seine eigene Datei konfiguriert, und sein Token liegt hier nur als
Hash. Eine wiederhergestellte Bibliothek behält deshalb die Runner-Zeilen, und die Runner
verbinden sich mit den Token wieder, die sie schon haben.

## Löschen statt sichern { #deleting-instead }

Partien zu entfernen steht unter [Partien](../guide/games.md#delete-games) und
[Bibliothek](../guide/library.md#manage), nicht auf dieser Seite. **Bibliothek → Verwalten
→ Importierte Bibliothek zurücksetzen** löscht die importierten Partien und alles, was an
ihnen hängt. Mach vorher eine Sicherung, falls du sie noch einmal haben willst.
