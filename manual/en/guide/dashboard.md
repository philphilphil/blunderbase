# Dashboard

The first screen: what the library holds, what has gone wrong lately, and what the engines
are doing. The line under the title counts your games and the blunders nobody has looked
at yet.

## Sync all accounts

**Sync all** re-syncs every account you have already connected, one after another. With
nothing connected the button reads **Connect account** instead, and **Import PGN** beside
it goes to the same place for a file. Both are [Library](library.md#import).

## Rating charts

One chart per speed, and one line per platform inside it, so Lichess blitz and Chess.com
blitz share a pair of axes. **Speeds** hides the ones you do not play, and the window
control cuts every chart at the same instant. Only rated games are plotted.

## Worst moments

The blunders of the last thirty days, each as the position it was played from, with the
move you played in red and the one the engine wanted in teal. Click a tile and the game
opens on that move. Empty means nothing analysed has gone badly wrong yet.

## Recent games

The last twelve to arrive, newest first. Point at a row for the opening, the source and
which pass has run over it; **All games** opens [Games](games.md).

## The analysis queue

How much is queued and how much is running, with each run appearing as it starts and a
**retry** beside one that failed. If it says the queue is not being drained, no worker is
picking runs up — see [Analysis](analysis.md).

## Trends

Blunders per game, the win percentage an average move gives away, and your score, each
against the equally long window before this one. The window control moves both halves.
