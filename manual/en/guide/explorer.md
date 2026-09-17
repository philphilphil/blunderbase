# Explorer

## Your own openings

**Explorer** puts a board beside your move tree. Play a move and the table shows how often
you reached that position, how you scored, and the worst move you played there. `←` and
`→` walk the line. **Games in this line** and **Your notes on this position** are beside
it.

The chips above the table narrow which of your games count: **speed** keeps only the time
controls you leave on, and **played** keeps only games from the last 30 days, 90 days or
year, counted back from today. The tree, its book line and the games below all follow them,
and the filter stays in the page's address, so a filtered tree is a link.

## The Lichess reference databases

The same board also reads two Lichess databases: **masters**, over-the-board games between
titled players, and the rated lichess pools, narrowable by speed and rating band. Neither
stores anything, and neither is counted in your own numbers.

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
needing a stored row: passes, notes, pinned lines. **+ Add to library** stores it as a game
you did not play, so it gets the analysis pass and takes notes but counts in no statistic and is
not in your opening tree.

## Build a repertoire

The repertoire keeps a white and a black tree of your own choosing. Play a line on the
board and press **Add this line**; **Promote to main** and **Delete branch** shape it, and
each move takes a comment saying why. It is not in the sidebar yet: open `/repertoire`
directly.
