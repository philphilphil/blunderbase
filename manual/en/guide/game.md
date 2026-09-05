# Analysing a game

## Move through the game

← and → step a move, ↑ and ↓ jump to the previous and next flagged move, Home and End go
to the ends, and Space plays the game through. `F` flips the board, `[` and `]` open the
previous and next game in your list. The full list is under [Settings](settings.md).

## What the badges mean

The move column marks a move `??`, `?`, `?!` or `!` and tints the flagged rows. The
**Flagged** tab beside **Moves** shows only those; `T` swaps. What earns each badge is in
[Analysis](analysis.md).

## Read the evaluation graph

The curve under the board is the evaluation move by move; clicking it seeks. Its shape and
its marks are board settings.

## Engine lines and the preview

The lines under the board are what the stored pass found: one for a quick pass, four for a
deep one. Point at one and it is drawn on the board, in whatever form you chose under
**Line preview**.

## Try a move of your own

Play a move on the board and you are in a variation; `Esc` returns to the game. **Pin this
line** keeps one with the game, so it is there next time and in the PGN export.

## Run the live engine

`E` opens the live engine on the position in front of you. Set how many lines it shows;
`↵` plays its move onto the board.

## What a human would play

The Maia panel gives five moves with the odds of each at the level you pick, not the best
move. It shows no line; see [Analysis](analysis.md).

## Write a note

`N` writes a note about the position on the board. Notes come back in every game that
reaches that position — see [Notes](notes.md).
