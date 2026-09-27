# Dashboard

The first screen: what the library holds, what has gone wrong lately, and what the engines
are doing. Like every screen it has no heading of its own: its name is in the title bar,
with its buttons right beside the name.

## Sync all accounts

**Sync all** re-syncs every account you have already connected, one after another. With
nothing connected the button reads **Connect account** instead, and **Import PGN** beside
it goes to the same place for a file. Both are [Library](library.md#import).

## Rating charts

One chart per speed, two to a row, and one line per platform inside each, so Lichess blitz
and Chess.com blitz share a pair of axes. **Speeds** hides the ones you do not play, and the
window control cuts every chart at the same instant. Only rated games are plotted.

## Worst moments

The blunders of the last thirty days, three to a row (six on a very wide screen), each as
the position it was played from. Under the board are the move you played and what it cost,
the move the engine wanted — drawn as a blue arrow and named after **Best:** — with the
phase of the game, and the opponent and the date. Click a tile and the game opens on that
move. Empty means nothing analysed has gone badly wrong yet. While the engine is hidden
(`⇧E`) the row is not there.

## Recent games

The last twelve to arrive, newest first. Point at a row for the opening, the source and
what has run over it; **All**, with the number of your games beside it, opens
[Games](games.md).

## The analysis queue

How much is queued and how much is running, with each run appearing as it starts and a
**retry** beside one that failed. If it says the queue is not being drained, no worker is
picking runs up — see [Analysis](analysis.md).

## Trends

Blunders per game, the win percentage an average move gives away, and your score, each
against the equally long window before this one. The window control moves both halves.
