# Analysis

## Why are there two engines?

|  | Stockfish | Maia |
|---|---|---|
| asks | what's best | what a human at the levels you pick would play |
| spends | on import, the node budget you set (500k by default); on a run you ask for, the seconds, depth or nodes you pick | one look, no search |
| gives | as many lines as the run keeps (2 by default, up to 5) | 5 moves per level, each with odds |
| lines? | yes | never |

Every number in that table is a setting: the budget and lines under **Analysis → Engine
passes**, the levels under **Analysis → Maia**.

## Which pass does a game get?

Every game that arrives gets the import pass: the engine holding the **Analysis** role,
the node budget and the line count from **Engine passes**, in the queue's own order.
Selected rows in **Games** get the same with **Queue analysis**.

When that is not enough, open the game and press **Analyse** (or `A`). You pick the
engine, the lines, where each move stops — after so many seconds, at a depth or after so
many nodes — and whether to look at one move, from a move to the end, or the whole game;
the dialog is described under [Analysing a game](game.md#ask-for-a-deeper-look). A run you
ask for goes ahead of every import pass still waiting.

What a game is read from:

- A run you asked for beats the import pass, whichever finished later. Between two runs of
  the same kind, the newer one wins.
- A whole-game run answers for the whole game, statistics included. A run over part of a
  game answers for those moves only, and the rest is read from the pass under it.
- The badge in the bar across the top of the game says what ran: `d24 · 2 lines`,
  `10s · 2 lines`, `500k · 2 lines`. A run you asked for is coloured; the import pass is
  plain. The game's row in **Games** only says **Analysed**, coloured the same way when a
  run you asked for is among its runs.

A limit in seconds depends on the machine: ten seconds on a fast server and ten seconds in
a browser tab are not the same search. Depth and nodes mean the same wherever they run.

## What did a move cost?

Win% before the move minus win% after it. The default thresholds:

| Drop | Badge |
|---|---|
| 5 | `?!` inaccuracy |
| 10 | `?` mistake |
| 15 | `??` blunder |

## What is left to analyse?

**Analysis → Coverage** says how much of the library an engine has been over and what
finishing it would cost. **Backfill** queues the import pass over every game that has no
pass yet; a game that already has one is skipped. On a large library and a slow server that
is a long wait, which is what the estimate on the card is for. **Fill missing levels** does
the same for Maia. **Clear the queue** empties it, and **Failed runs** lists what to retry;
a retry runs again with the engine, limit, moves and lines it failed with.

## How much work does a pass do?

**Analysis → Engine passes → Analysis pass** sets the import pass's node budget (500,000 by
default) and how many lines it keeps (1 to 5, two by default), and the three thresholds
above. The budget and the lines are copied onto a pass when it is queued, so a change
applies to the next one. They are also where **Analyse** starts when you pick nodes, and
the lines it offers before you type a number.

## Hide the engine on new games

The same page has **New games → Hide the engine on**, and each choice names the speeds it
covers: **Nothing**, **Every game**, **Blitz, rapid and classical**, **Rapid and classical**
or **Classical only**. A game you import from then on at one of those speeds is analysed as
usual but arrives quiet: no evaluation, badge, graph or line until you press **Show the
engine** in the row under the board of that game. The idea is to read your own game first —
where did it turn? — and only then ask, which is worth doing for a game you thought about
and not for the bullet game you did not.

A game with no time control at all — a PGN of an over-the-board game — counts as classical,
so every choice but **Nothing** covers it, and so does an imported correspondence game.
Games already in the library are left as they are, and so are the games of Blunderbase's own
correspondence mode and model games from the reference explorer; in the games list and on
the dashboard a hidden game shows an eye instead of its worst move. `⇧E` still hides
everything everywhere on top of this; the difference is that `⇧E` is a switch of the
browser, and this is stored on each game.

## What is Maia asked?

**Analysis → Maia** sets which human levels are asked, up to five ratings between 1100 and
2000 (a fresh installation asks 2000 only), **Maia on the analysis pass** — on by default,
it adds a Maia look to every pass, the import pass and the ones you ask for alike — and
**Ask about both sides**: off looks at your moves only, on predicts the
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
| **Lines per search** | How many candidate lines an engine keeps when it is set on one position of a correspondence tree, 1 to 5, three by default |
| **Nodes per task** | What one task costs, forty million by default: a minute or two of a modern engine, which is what makes an expansion of a dozen positions finish while you are still looking at the board. It is copied onto a task when the task is queued, so changing it sizes the next one |
| **Lines per task** | How many candidate lines a task keeps, 1 to 5, three by default — and therefore how wide an expansion can be, since the children are made from those lines |
| **Stale below depth** | Below this depth a stored verdict is marked stale on the tree, 1 to 100, thirty by default. The other half of stale needs no number: a verdict written by a version of the engine that is no longer installed is stale however deep it went |

There is no engine setting: which engine searches or works a task is chosen on the
position, in the dialog, from every engine that is switched on — see
[Search a position](correspondence.md#search-a-position). The engine holding the **Analysis**
role is the one suggested. And there is no slot count here: how many searches this machine
runs at once is a fact about the machine, set beside the queue's own cap on
[Machines](../operate/runners.md#how-much-at-once).

An empty box means the default is in force. What the mode itself does is
[Correspondence](correspondence.md), and how to give it an engine of its own is
[Engines](../operate/engines.md).
