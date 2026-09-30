# Dashboard

The first screen: what the library holds, what has gone wrong lately, and what the engines
are doing. Like every screen it has no heading of its own: its name, **Dashboard**, is in the
title bar, and its two buttons sit at the right end of that bar.

## Sync all accounts

**Sync all**, the blue button, re-syncs every account you have already connected, one after
another; point at it to see which. With nothing connected it reads **Connect account**
instead, and **Import PGN** beside it goes to the same place for a file. Both are
[Library](library.md#import).

## Rating charts

One chart per speed, two to a row, and one line per platform inside each, so Lichess blitz
and Chess.com blitz share a pair of axes. The window control (**All**, **1y**, **90d**,
**30d**) cuts every chart at the same instant. The **Speed** picker beside it reads
**Speed: All**; click it for a checkbox per speed, bullet to classical with your number of
rated games beside each, and untick the ones you do not play, and it
names the ones left (**Speed: Blitz, Rapid**). The last one cannot be unticked, and the
**×** beside a narrowed picker brings every speed back. This browser remembers the choice.
Only rated games are plotted.

## Worst moments

The blunders of the last thirty days, three to a row (six on a very wide screen), each as
the position it was played from. Under the board are the move you played and what it cost,
the move the engine wanted — drawn as a blue arrow and named after **Best:** — with the
phase of the game, and the opponent and the date. Click a tile and the game opens on that
move. Empty means nothing analysed has gone badly wrong yet. While the engine is hidden
(`⇧E`) the row is not there.

## Recent games

The last twelve to arrive, newest first. Point at a row for the opening, the source and
what has run over it; **All ›**, with the number of your games beside it, opens
[Games](games.md).

## The analysis queue

How much is queued and how much is running, with each run appearing as it starts and a
**retry** button beside one that failed. The dot beside the heading says how the queue is:
grey while it is idle, green and pulsing while something runs, orange with **workers idle**
when nothing is picking runs up — see [Analysis](analysis.md). With nothing outstanding,
**Pick a game** opens [Games](games.md) to find one to analyse.

## Trends

Blunders per game, the win percentage an average move gives away, and your score, each
against the equally long window before this one. The window control (**7d**, **30d**,
**90d**) moves both halves.
