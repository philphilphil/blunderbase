# Explorer

## Your own openings

**Explorer** puts a board beside your move tree. Play a move and the table shows how often
you reached that position, how you scored, and the worst move you played there. `←` and
`→` walk the line. **Games in this line** and **Your notes on this position** are beside
it.

## The Lichess reference databases

The same board also reads two Lichess databases: **masters**, over-the-board games between
titled players, and the rated lichess pools, narrowable by speed and rating band. Neither
stores anything, and neither is counted in your own numbers.

## Add a Lichess token

Both reference databases need a Lichess personal API token. Create one at
<https://lichess.org/account/oauth/token> with **no scopes ticked**, and paste it where the
reference sources ask. Without it they refuse rather than come back empty. An empty box
clears the stored token.

## Open a model game

**Model games** lists games from those databases. One opens in the full game view, with
the live engine and Maia working as they do on your own games. What is missing is anything
needing a stored row: passes, notes, pinned lines. **+ Add to library** stores it as a game
you did not play, so it gets a quick pass and takes notes but counts in no statistic and is
not in your opening tree.

## Build a repertoire

The repertoire keeps a white and a black tree of your own choosing. Play a line on the
board and press **Add this line**; **Promote to main** and **Delete branch** shape it, and
each move takes a comment saying why. It is not in the sidebar yet: open `/repertoire`
directly.
