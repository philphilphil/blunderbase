# Library

Two pages: **Import**, where games come in, and **Manage**, where they go out or go away.

## Import

The page is three regions, top to bottom: **Accounts**, where synced games come from,
**PGN file**, and the **Sync history** of both.

### Connect an account

Under **Accounts** there is a box for Lichess, Chess.com and FICS, each headed by the
site's name and, once connected, how many games came from it. Put the username in, press **Connect**,
then **Sync**. The same button syncs it again afterwards, resuming where the last finished
run stopped. Every import is deduplicated on the way in, so a second sync of the same
archive stores nothing twice.

A name the site does not know fails the sync and connects nothing, so a typo can simply be
corrected and connected again. FICS cannot tell an unknown name from a player without
games; its box connects with the first game it finds. A Lichess game still being played,
such as a correspondence game, is left out until it has ended, and the first sync after
that brings it in, however long it ran. A correspondence game that ended before this
version and never arrived comes in with one sync **From the beginning**.

### Sync options

The head of **Accounts**, above the boxes, is read by every account:

| Control | Effect |
|---|---|
| **Since** | Only games played from this date on |
| **Max games** | Stop after this many; blank means all |
| **From the beginning** | Ignore the stored cursor and read the whole archive |
| **Skip evaluation** | Store the games and queue no analysis pass |

A PGN file takes none of these; its region has its own **Skip evaluation**.

### Sync all

**Sync all**, at the end of the head, presses **Sync** on every connected account whose box
has **Include in sync** ticked, told what the head says. It syncs the account each box
shows; a new username is connected with that box's own **Connect**. While it cannot be
pressed, pointing at it says why: nothing is connected yet, every account is left out, or a
sync is already running.

### Sync automatically

**Sync automatically**, the switch at the foot of **Accounts**, presses **Sync** on every
connected account for you, every so many minutes, one account at a time. Switch it on and
set the minutes in the box beside it. The box shows the interval actually in force, which
may be rounded up from what you typed; switched off, it keeps the last number, greyed.

### Import Lichess games live

The Lichess box has **Connect Lichess** under it. It takes you to lichess.org to approve
Blunderbase, then back. From then on the box says **Connected as** your Lichess name, and a
game you finish there shows up in Blunderbase a few seconds after it ends, with its
analysis queued, as if you had pressed **Sync** yourself. The same connection is what the
[reference databases](explorer.md#connect-lichess) need.

It only works for the Lichess account you signed in with. That account needs one ordinary
sync first, and its box needs **Include in sync** ticked; the line under **Connected as**
tells you which of those is missing. **Sync automatically** keeps running beside it and
picks up any game that ended while the connection was down. **Disconnect** removes the
connection from Blunderbase and revokes it on Lichess.

On the desktop app, approving happens in your usual browser, where you are probably already
signed in to Lichess. Close that tab afterwards; the app updates by itself. Lichess shows
"Does not use a secure connection" on the approval page when Blunderbase is reached over
plain `http` at an address other than `localhost`. It still works.
Chess.com and FICS cannot tell anyone when a game ends, so they are only synced.

### Stop a sync

A sync in flight shows its counts in its own box with **Stop** beside them. It stops after
the game it is on. What arrived stays, the history records **Stopped**, and **Sync** picks
up from there.

### Import a PGN file

Under **PGN file**, press **Choose file…**, or drop a file on that region or anywhere in the
window; several at once are read as one file. Say whether the games are **Mine** or **Not
mine**, tick **Skip evaluation** if the games should only be stored, then press **Upload**.
**Upload** stays greyed until a file is chosen. Games that are not yours are analysed and
searchable like any other, but count in no statistic. A file dropped elsewhere in the window
asks the same question in a small dialog before it imports.

The file may be UTF-8 or the Latin-1 / Windows-1252 that ChessBase and many older programs
write; each file is read in whichever of the two it is, so accented names such as "Müller"
arrive as written.

### Correspondence games

A game you are still playing is not imported here. It is entered under
[Correspondence](correspondence.md), which stores it with the source **ICCF** when you give
it an ICCF game number and as a manual game when you do not.

It is a library game from the day you create it, not from the day it ends: it stands in
**Games** straight away with no moves yet and the result still open, the sync history below
records it as a one-game run under its source, and it grows a move at a time as you enter
the moves. It is left unanalysed while it runs — its tree is where the engines' work is
kept — and finishing it queues the ordinary analysis pass, after which it reads like
every other game.

### Read the sync history

Every run, newest first: the source, when it started, how long it took, and how many games
it saw, imported, skipped, refused as previously deleted and failed on, and its status as a
coloured dot and a word (**Done**, **Failed**, **Stopped**). A run that lost games has an
arrow in front of it: **Show failures** opens the games it could not store under that row.
Past 25 runs the list turns pages with the arrows at its foot.

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

**Reset imported Library…**, the red outlined button, deletes every game with its analysis,
its game notes and the sync history. Accounts, engines and position-only notes stay. It
asks first, with your password on a server, and only **Delete them** in that dialog
deletes. There is no undo.

### Deleted games

**Deleted games** is the record of what an import must not store again — without it the
next sync would fetch a deleted game back as something new. **Forget** on a row, or
**Forget all**, gives the next import permission to store it again, without the analysis
and notes the original had. It brings no game back, which is why the button does not say
restore. The card is absent on a library that has deleted nothing.
