# Analysing a game

## Move through the game

← and → step a move, ↑ and ↓ jump to the previous and next flagged move, Home and End go
to the ends, and Space plays the game through. `F` flips the board, `[` and `]` open the
previous and next game in your list. The full list is under [Settings](settings.md).

The bar across the top names the opening, where the game came from, its time control and
how it ended. On a Lichess or Chess.com game the source chip there is a link that opens the
game on that site in a new tab; on a phone the same link is the arrow beside the PGN button.

## What the badges mean

The move column marks a move `??`, `?`, `?!` or `!` and tints the flagged rows. The
**Flagged** tab beside **Moves** shows only those. What earns each badge is in
[Analysis](analysis.md).

## Read the evaluation graph

The curve under the board is the evaluation move by move; clicking it seeks. Its shape and
its marks are board settings.

## See how long each move took

Where the game was played with a clock, the graph pane has a second tab, **Move time**:
one column per move, White's up and Black's down, as tall as the think that went into it,
with the same blunder and mistake marks as the evaluation. The scale is compressed, so a
short move and a long one differ in height while a single very long think does not
flatten the rest; thinks over two minutes are drawn as two minutes. A faint line on each
side marks the increment, so a column under it is a move that gained time. Beside the
plot each player's average think, longest think and time left at the end take the place
of the accuracy tallies — a player who lost on time is left with `0:00` — and pointing at
a column reads the move number and the think; the move and its clock are in the move
table beside it. The first move of each side is played before the clock starts and is
not counted. Clicking seeks, as on the evaluation. `T` opens this tab and `V` goes back to
**Evaluation**.

## Engine lines and the preview

The lines under the board are what the stored pass found: as many as that pass kept, two
by default for the pass every game gets on import, as many as you chose for one you asked
for. Point at one and it is drawn on the board, in whatever form you chose under
**Line preview**.

## Ask for a deeper look { #ask-for-a-deeper-look }

**Analyse**, at the right end of the engine pane's title on the **Run** tab, or `A`, opens
a dialog that queues a run of your own over this game. While the
engine is hidden the pane is gone, and the button moves to the row under the board. The run
goes ahead of every import pass still waiting, and the button spins until it is done; until
then neither the button nor `A` opens the dialog again. The square beside it stops the run,
whether it is still waiting or already searching, and keeps nothing of it — the game stays
as it was before you asked. While the analysis queue is paused, a run that has not started
reads **Paused** instead of spinning, and starts once the queue is resumed; a run already
searching carries on.

| | |
|---|---|
| **Engine** | Every engine that is switched on and speaks UCI, on this machine and on your runners. The one holding the **Analysis** role is picked when the dialog opens; one that cannot run — its program gone, Maia on another machine — is greyed, with the reason written under the engines |
| **Lines** | How many candidate lines to keep per move, 1 to 5. Blank takes the import pass's line count from [Analysis](analysis.md#how-much-work-does-a-pass-do) |
| **Stop each move at** | A number of **seconds**, a **depth** or a number of **nodes**. It opens on depth 24; switching to seconds starts at 5, switching to nodes at the import pass's budget |
| **Moves** | **This move** — the move that led to the position on the board, the one whose badge you are looking at; **From here on** — that move to the end; **Whole game**, which is where it opens. The first two are greyed at the starting position |

A whole-game run becomes what the game is read from, statistics included; a run over part
of the game answers for those moves and leaves the rest as it was. The **Run** tab's title
then says what ran, `d24` and `MPV 2` for the default. What the dialog cannot
queue — the engine switched off, a runner gone away — is said inside it, and nothing is
queued. With no engine at all, the dialog offers to set up Stockfish in this browser
instead; see [Engines](../operate/engines.md#the-engine-in-your-browser).

## Try a move of your own

Play a move on the board and you are in a variation; `Esc` returns to the game. **Pin this
line** keeps one with the game, so it is there next time and in the PGN export.

You can type the moves instead. `M`, or the keyboard button beside **Hints**, opens a small
box under the board: type `Nf3`, `exd5`, `O-O` or `e8=Q` — or plain `g1f3` — and the move
is played the moment it can only mean one thing, so a whole line goes in as one run of
moves. Captures, checks and `=` are optional, the piece letters of your language work
(`Sf3` in German), and a move two pieces could make (`Nd2` with both knights able) is
reported as ambiguous until you add the file. `↵` plays what is typed when the box is
waiting for more, `Esc` closes it. While the box has the cursor, the arrow keys move the
caret rather than the game.

## Practise from a position

**Practise**, in the row under the board, or `P`, plays the position on the board out against
the computer. The dialog asks three things:

| | |
|---|---|
| **You play** | White or Black. It opens on the side at the bottom of the board |
| **Against** | Maia, or any search engine that is switched on, on this server, on a runner or in this browser. It opens on Maia where Maia can answer. An engine that cannot answer right now is greyed out, and the reason is written under the list |
| **Strength** | For an engine that has a rating limit, a rating between the lowest and highest it accepts, or **Full strength**. It opens on your Maia target rating. Stockfish's limit is calibrated for about a second a move. An engine without one plays at full strength. For Maia this is the **Maia level** instead, from the levels set in [Analysis](analysis.md) |
| **Think time** | How long an engine searches for each move: half a second to five seconds |

If the computer is to move, it moves first. Play your moves on the board or type them with
`M`. The engine searches for the think time and plays the move its rating limit picks. Maia
plays a move humans at its level play in the position, chosen by how often they play it, so
it makes their mistakes too.

While you practise, the evaluation, the engine pane, Maia, the graph and the arrows are
hidden. A strip in their place says whose move it is. **Show the engine**, or `H`, brings
them back without ending the game and starts the live engine on the position, on the
**Live** tab. Hiding them again stops it. **Take back** removes your last move and the reply to it.
The game ends by itself on mate, stalemate, insufficient material, the fifty-move rule or a
threefold repetition.

**Stop**, `P` or `Esc` ends practice. The moves stay on the board as a line, so you can switch
on the live engine and see where it went wrong, or keep the line with **Pin this line**.
Leaving the line or going back to the game also ends practice. Nothing is stored unless you
pin it.

## Run the live engine

The engine pane has two tabs, **Run** and **Live**: what the stored pass found, and what
an engine finds now, which stores nothing. Clicking **Live**, or `E`, starts the live engine
on the position in front of you and moves the pane there. While it runs the **Live** tab
carries a small square: click it, or press `E` again, to stop the search and go back to
**Run**. You can also click **Run** to look at the stored lines while the engine keeps
going — the dot on the **Live** tab keeps pulsing until you stop it.

On the **Live** tab the engine's name and the line count in the title are pickers: click
the name to choose which engine searches, the count to choose how many lines it shows.
`↵` plays its move onto the board. Once you leave the game line the pane goes to **Live**
by itself while a search is running, since the stored pass never looked at the position
you are in.

## What a human would play

The Maia panel gives five moves with the odds of each at the level you pick, not the best
move. It shows no line; see [Analysis](analysis.md). `L` sets every level side by side, and
pressed again goes back to the one you picked.

## Read a game without the engine

`⇧E`, or the computer in the title bar, takes every engine verdict off this screen: the
evaluation bar and the score, the `??` badges and the tinted rows, the graph, the engine
and Maia panels. The moves, the clocks and your notes stay, and so does **Analyse** —
write down what you think went wrong, then ask and see. The mode
holds until you press it again; the whole of it is under
[Settings](settings.md#hide-the-engine).

A game can also arrive quiet on its own: with **Hide the engine on new games** on under
[Analysis](analysis.md#hide-the-engine-on-new-games), every newly imported game is analysed
but shows nothing of it, and a **Show the engine** button sits in the row under the board.
Read the game, then press it — that game speaks from then on, and the others are untouched.

## Write a note

`N` writes a note about the position on the board; **Enter** saves it, **Shift+Enter** is a
new line. Notes come back in every game that reaches that position — see [Notes](notes.md).
The **Book** tab beside **Notes** shows how your own games went on from here; `B` opens it.
It is headed with the name of the opening the game is in, and a move that enters a named
opening shows that name in its **Opening** column.

## The correspondence tree

A game you played by correspondence carries a **Correspondence tree** button in the title
bar. It opens the tree that was built while the game was running — the candidate moves, the
comments and what the engines said about each position — to read, not to change: the tree
froze when the game did. The button is there only for those games, and only while
correspondence mode is on; the mode is [Correspondence](correspondence.md).
