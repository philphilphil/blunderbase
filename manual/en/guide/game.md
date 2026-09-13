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
**Flagged** tab beside **Moves** shows only those; `T` swaps. What earns each badge is in
[Analysis](analysis.md).

## Read the evaluation graph

The curve under the board is the evaluation move by move; clicking it seeks. Its shape and
its marks are board settings.

## See how long each move took

Where the game was played with a clock, the graph pane has a second tab, **Move time**:
one column per move, White's up and Black's down, as tall as the think that went into it,
with the same blunder and mistake marks as the evaluation. A faint line on each side marks
the increment, so a column under it is a move that gained time. Beside the plot each
player's average think, longest think and time left at the end take the place of the
accuracy tallies; pointing at a column reads the move number, the think and what was left
on the clock after it. Clicking seeks, as on the evaluation.

## Engine lines and the preview

The lines under the board are what the stored pass found: one for a quick pass, four for a
deep one. Point at one and it is drawn on the board, in whatever form you chose under
**Line preview**.

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

## Run the live engine

The engine pane has two tabs, **Run** and **Live**: what the stored pass found, and what
an engine finds now. `E`, or the switch at the right end of the pane's title, starts the
live engine on the position in front of you and moves the pane to **Live**; the same key
or switch stops it and moves it back. While the engine runs you can click **Run** to look
at the stored lines again — the dot on the **Live** tab keeps pulsing until you stop the
search.

On the **Live** tab the engine's name and the line count in the title are pickers: click
the name to choose which engine searches, the count to choose how many lines it shows.
`↵` plays its move onto the board. Once you leave the game line the pane goes to **Live**
by itself while a search is running, since the stored pass never looked at the position
you are in.

## What a human would play

The Maia panel gives five moves with the odds of each at the level you pick, not the best
move. It shows no line; see [Analysis](analysis.md).

## Read a game without the engine

`⇧E`, or the computer in the title bar, takes every engine verdict off this screen: the
evaluation bar and the score, the `??` badges and the tinted rows, the graph, the engine
and Maia panels. The moves, the clocks and your notes stay, and so do the **Quick** and
**Deep** buttons — write down what you think went wrong, then press one and see. The mode
holds until you press it again; the whole of it is under
[Settings](settings.md#hide-the-engine).

A game can also arrive quiet on its own: with **Hide the engine on new games** on under
[Analysis](analysis.md#hide-the-engine-on-new-games), every newly imported game is analysed
but shows nothing of it, and a **Show the engine** button sits in the row under the board.
Read the game, then press it — that game speaks from then on, and the others are untouched.

## Write a note

`N` writes a note about the position on the board; **Enter** saves it, **Shift+Enter** is a
new line. Notes come back in every game that reaches that position — see [Notes](notes.md).

## The correspondence tree

A game you played by correspondence carries a **Correspondence tree** button in the title
bar. It opens the tree that was built while the game was running — the candidate moves, the
comments and what the engines said about each position — to read, not to change: the tree
froze when the game did. The button is there only for those games, and only while
correspondence mode is on; the mode is [Correspondence](correspondence.md).
