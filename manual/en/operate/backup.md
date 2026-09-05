# Backup and restore

Two different things live under **Library → Manage**, and they are not substitutes.

| | PGN export | Database backup |
|---|---|---|
| What it is | A portable copy for other chess software | A lossless copy of the whole installation |
| Holds | Games, original headers, comments and variations. Blunderbase notes become comments, saved lines become variations | Games, annotations, analysis, accounts, settings, credentials and engine configuration |
| Loses | Engine evaluations, accounts, analysis settings, import cursors | Nothing |
| Restore it | By importing the file anywhere | Only from the command line, with Blunderbase stopped |

## Export PGN

**Library → Manage → Export PGN** downloads every stored game in one
`blunderbase-library.pgn`.

This is the copy you give to another program. It is not an application backup.

## Download a backup

**Library → Manage → Download backup** creates the lossless, integrity-checked SQLite copy.
The download appears once Blunderbase has prepared a consistent snapshot.

You may take a backup while Blunderbase is running. SQLite's online backup interface
includes all committed write-ahead-log transactions in one consistent snapshot.

**Store it like a password.** Passwords and API keys are hashes rather than plaintext, but
the file is still private.

The same thing from a shell:

```bash
blunderbase db backup /safe/place/blunderbase-2026-09-01.db
```

Both the backup and the restore run SQLite's full integrity check, require a Blunderbase
schema revision, and print the byte count, the revision and a SHA-256. **The two SHA-256
values must match.**

`--force` replaces an existing output file.

## Restore

Restoring replaces the database underneath the process, so it is deliberately not available
in the running web app. It is a command-line operation with Blunderbase stopped.

Stop every process using that database first. Then, on the replacement installation:

```bash
blunderbase db restore /safe/place/blunderbase-2026-09-01.db --force
blunderbase db upgrade
```

Restore verifies the input *before* touching the configured database, installs it by atomic
rename, and refuses to replace an existing database without `--force`.

`db upgrade` brings an older backup to the current schema. It is safe when restoring an
older release and does nothing at the current revision.

Start Blunderbase and confirm the count on the Library screen.

## With Docker

Copy the verified backup out of the named volume rather than leaving the only copy beside
the live database.

```bash
docker exec blunderbase blunderbase db backup /data/blunderbase-backup.db
docker cp blunderbase:/data/blunderbase-backup.db ./blunderbase-backup.db
```

To restore it:

```bash
docker compose stop blunderbase
docker cp ./blunderbase-backup.db blunderbase:/data/restore.db
docker compose run --rm --no-deps \
  --entrypoint blunderbase blunderbase db restore /data/restore.db --force
docker compose up -d blunderbase
```

The container runs `db upgrade` on start-up, so the last command covers the migration.

## What is not in either

Nothing about the engines on other machines. A [runner](runners.md) is configured on its own
machine by its own file, and its token is stored here only as a hash, so a restored library
keeps the runner rows and the runners reconnect with the tokens they already have.

## Deleting instead

Removing games is [Games](../guide/games.md#delete-games) and
[Library](../guide/library.md#manage), not this page. **Library → Manage →
Reset imported Library** deletes the imported games and everything attached to them; take a
backup first if you might want them again.
