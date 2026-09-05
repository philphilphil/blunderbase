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
