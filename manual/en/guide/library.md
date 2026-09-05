# Library

Two pages: **Import**, where games come in, and **Manage**, where they go out or go away.

## Import

### Connect an account

There is a box for Lichess, Chess.com and FICS. Put the username in, press **Connect**,
then **Sync**. The same button syncs it again afterwards, resuming where the last finished
run stopped. Every import is deduplicated on the way in, so a second sync of the same
archive stores nothing twice.

### Sync options

The strip above the boxes is read by every source:

| Control | Effect |
|---|---|
| **Since** | Only games played from this date on |
| **Max games** | Stop after this many; blank means all |
| **From the beginning** | Ignore the stored cursor and read the whole archive |
| **Skip evaluation** | Store the games and queue no analysis pass |

### Sync automatically

**Sync automatically** presses **Sync** on every connected account for you, every so many
minutes, one account at a time. The box shows the interval actually in force, which may be
rounded up from what you typed.

### Stop a sync

A sync in flight shows its counts in its own box with **Stop** beside them. It stops after
the game it is on. What arrived stays, the history records **Stopped**, and **Sync** picks
up from there.

### Import a PGN file

Choose a file in the PGN box, or drop one anywhere in the window; several dropped at once
are read as one file. Say whether the games are **Mine** or **Not mine** first. Games that
are not yours are analysed and searchable like any other, but count in no statistic.

### Read the sync history

Every run, newest first: the source, when it started, how long it took, and how many games
it saw, imported, skipped, refused as previously deleted and failed on. **Show failures**
narrows it to the runs that went wrong.

## Manage

### Export a portable PGN

**Export PGN** downloads every game with its notes and saved lines as comments and
variations, for another chess application. Engine analysis and settings are not part of
PGN.

### Download a database backup

**Download backup** takes a consistent copy of the SQLite file — analysis, accounts and
settings included — once the server has prepared the snapshot. The estimated size is shown
before you press it. Restoring one needs the command line with Blunderbase stopped: see
[Backup and restore](../operate/backup.md).

### Reset the imported library

**Reset imported Library** deletes every game with its analysis, its game notes and the
sync history. Accounts, engines and position-only notes stay. It asks for your password,
and there is no undo.

### Deleted games

**Deleted games** is the record of what an import must not store again — without it the
next sync would fetch a deleted game back as something new. **Forget** on a row, or
**Forget all**, gives the next import permission to store it again, without the analysis
and notes the original had. It brings no game back, which is why the button does not say
restore. The card is absent on a library that has deleted nothing.
