# Analysis

## Why are there two engines?

|  | Stockfish | Maia |
|---|---|---|
| asks | what's best | what a human at the levels you pick would play |
| spends | the node budget you set per tier (250k quick, 2M deep by default) | one look, no search |
| gives | 1 line quick; on deep as many as you keep (4 by default) | 5 moves per level, each with odds |
| lines? | yes | never |

Every number in that table is a setting: the budgets and lines under **Analysis → Engine
passes**, the levels under **Analysis → Maia**.

## Quick or deep?

Quick runs on import. Deep is the one you ask for, and it jumps the queue. Queue either
from a game with `Q` and `D`, or over selected rows in **Games**. A game that has a deep
pass is read from it rather than from the quick one.

## What did a move cost?

Win% before the move minus win% after it. The default thresholds:

| Drop | Badge |
|---|---|
| 5 | `?!` inaccuracy |
| 10 | `?` mistake |
| 15 | `??` blunder |

## What is left to analyse?

**Analysis → Coverage** says how much of the library an engine has been over and what
finishing it would cost. **Backfill quick** and **Backfill deep** queue the rest; a game
that already has that tier is skipped. **Fill missing levels** does the same for Maia.
**Clear the queue** empties it, and **Failed runs** lists what to retry.

## How much work does a pass do?

**Analysis → Engine passes** sets the node budget of each tier, how many lines a deep pass
keeps, and the three thresholds above.

## What is Maia asked?

**Analysis → Maia** sets which human levels are asked, up to five ratings between 1100 and
2000 (a fresh installation asks 2000 only), whether Maia runs on quick passes, deep passes
or both, and **Ask about both sides**: off looks at your moves only, on predicts the
opponent's too. It never answers with a line: one look and no search gives a
spread of moves, not a continuation. A *fill* pass adds levels to a game that already has
an evaluation.

## Correspondence

**Analysis → Correspondence** switches the correspondence mode on, holds the numbers a new
game and a new search start with, and says which engines may be set on a position. Off —
the default — there is no **Correspondence** in the sidebar and its pages send you home.

| Setting | |
|---|---|
| **Correspondence mode** | On adds the sidebar entry under **Live** |
| **Days per move** | The reply window a new game is given, 1 to 365, ten by default. It is copied onto a game when the game is created, so changing it here leaves games already under way alone |
| **Lines per search** | How many candidate lines an engine keeps when it is set on one position of a correspondence tree, 1 to 5, three by default |
| **Search slots** | How many searches this machine runs at once, 1 to 16, two by default — one CPU engine and one GPU engine is the ordinary pair. Searches have slots of their own, so a search that runs for days never takes one an imported game's quick pass is waiting for. It is read when the server starts: **change it and restart** |
| **Search engines** | Which engines the **Search with…** picker offers, in your order; the first is the one it suggests. Choose none and every engine that is eligible is offered — enabled, UCI, able to drive a board, and on this machine. An engine on a remote runner cannot run a search yet |

An empty box means the default is in force. What the mode itself does is
[Correspondence](correspondence.md), and how to give it an engine of its own is
[Engines](../operate/engines.md).
