# Explorer

## Your own openings

**Explorer** puts a board beside your move tree. Play a move, on the board or by clicking
its row, and the table shows how often you reached that position, how you scored, and the
worst move you played there. The move you play most is in bold. **Games in this line** and
**Your notes on this position** are beside it.

Above the board, the name of the opening and the **Line**: every move played so far, from
**start** to the move you stand on. Click any move in it to go back to that position. Under
the board, the arrow buttons (or `←` and `→`) step back and forward along the line,
**Flip** turns the board, and **Reset** goes back to the start.

Above the table, two switches decide which book you are reading. **Games from** picks your
own games, **masters** or **lichess** (see [below](#the-lichess-reference-databases)), and
**Colour** counts both of your colours, only the games you had white, or only those you had
black.

Beside them, pickers narrow which of your games count. **Speed** opens a list of the time
controls; untick the ones to leave out, and the picker then names the ones left on
("Speed: Blitz, Rapid"). **Date** is the same date filter as the one over your
[games](games.md): two date fields and the quick picks Today, 7d, 30d, 90d and 1y, each
counted back from today. **Today** is the quick way to look over the openings you just
faced. A pick fills the fields with the days it covers, so you can nudge it from there,
and a link to "the last 30 days" still means the last 30 days when you open it next month;
typed dates stay the dates you typed. **Clear**, or the **×** on a picker, counts every
game again.
Once you have a [collection](collections.md), **Collection**, under the date,
keeps only the games in one of them, so a league season has an opening tree of its own; on
**All games**, a collection's games are in the tree like every other. The tree, its book
line and the games below all follow these, and the filter stays in the page's address, so a
filtered tree is a link.

When the pane is narrow, the table leaves out its **Opening** and **Note** columns; point at
a row to read them. **Open in Games**, beside **Games in this line**, opens the
[Games](games.md) page filtered to this opening, with your colour, a single speed, the dates
and the collection carried over.

In the sidebar, **Your lines** under **Explorer** lists the openings you reach most, with
how you score in each. Click one to see your games in that opening.

## The Lichess reference databases

The same board also reads two Lichess databases: **masters**, over-the-board games between
titled players, and the rated **lichess** pools, narrowable with the **Speed** picker and the
**Rating** bands. Neither stores anything, and neither is counted in your own numbers.
**Colour** stays in place but greyed out, since only your own games have a colour of yours.

## Connect Lichess

Lichess only answers signed-in requests to both reference databases. The first time you
open one, it offers **Connect Lichess**: approve Blunderbase on lichess.org and you come back
to the same position with the table filled in. The approval page lists "Read incoming
challenges", which is the permission the [live import](library.md#import-lichess-games-live)
needs; the databases themselves need none. If Lichess later stops accepting the connection,
because you revoked it on lichess.org or it expired after a year, the same place offers
**Reconnect Lichess**.

A token pasted in an earlier version keeps working for the databases. To import games live,
connect once more on the Import page.

## Open a model game

**Model games** lists games from those databases. One opens in the full game view, with
the live engine and Maia working as they do on your own games. What is missing is anything
needing a stored row: passes, notes, pinned lines. **Add to library** stores it as a game
you did not play, so it gets the analysis pass and takes notes but counts in no statistic and is
not in your opening tree.

## Build a repertoire

The repertoire keeps a white and a black tree of your own choosing; the **white** / **black**
switch beside its name picks which one you see. Play a line on the board and it is saved as
you go; a line that is not in the tree yet offers **Add this line**. **Promote to main** and
**Delete branch** (click it twice) shape the tree, and each move takes a comment saying why.
The board, the **Line** and the arrow buttons work as they do in the explorer. It is not in
the sidebar yet: open `/repertoire` directly.
