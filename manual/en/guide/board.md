# Board

## What is the board?

An analysis board. Put any position on it, from a FEN, a PGN or the starting position,
play moves, step back and forth through them, and let an engine search wherever you are. The
engine can be one on another machine, such as a remote runner on a faster computer (see
[The engine panel](#the-engine-panel)). Nothing you do here changes a stored game.

The board is also the one your AI assistant shows you things on. You and the assistant
share it: whatever either of you puts up, the other sees, and the assistant can read back
the position you are looking at. **Flip the board** turns it round for you only.

## Load a position

**Load…** opens a box that takes a FEN or a PGN. Paste either one; the label above the box
says which it has recognised. A PGN brings its mainline, and the board stands at its last
move. The PGN's own variations and comments are left out. A PGN that starts from a
`FEN` header starts there. If the text cannot be read, the reason appears under the box and
the box stays open so you can fix the paste. **Starting position** clears the board back
to the initial position.

You don't need the box at all: press ⌘V / Ctrl+V anywhere on the page, outside a text
field, with a FEN or a PGN on the clipboard, and it is loaded straight away.

**Reset** takes everything off the board, including a queue of positions the assistant
put up.

## Play and step through moves

Drag a piece to play a move; a pawn that reaches the last rank becomes a queen. On an empty
board the first move starts from the initial position.

The **Moves** card lists the mainline, meaning the game or PGN you loaded, and
the moves you played off it, in brackets after the move they leave from. Click any move to
put the board there, or press ← and → to step. **Start** is the position the line begins
from.

How a move you play is placed:

- If it is the next move of the line you are on, the board simply steps forward along it.
- Anything else is your own variation. Played in the middle of your variation, it replaces
  the rest of the variation from there.
- There is one variation at a time. It stays listed while you step through the mainline,
  and starting a new one somewhere else replaces it.

## The engine panel

Switch the panel on to have an engine search the position on the board, and keep searching
as you move. The engine's name is a picker: choose any engine that can run a live search,
including one on a [remote runner](../operate/runners.md#remote-runners), so a fast
machine elsewhere does the thinking while you work here. The line count beside it sets how
many lines it shows. Point at a line to see its first move as an arrow on the board; click a
move in a line to play the line up to that move. It works like
[the live engine on a game](game.md#run-the-live-engine).

## What the assistant can put on it

Ask your assistant for it. `show_game` puts a stored game on the board, and you can step
through its moves in the **Moves** card. `show_position` puts up a FEN. The assistant can
draw arrows and colour squares as it goes, and play moves. When it puts up several
positions at once, **Prev** and **Next** in the header step through them. Connecting a
client in the first place is [Your AI assistant](coach.md).

On the public demo the board belongs to your browser tab alone. It is not shared, and the
assistant cannot reach it.

## The Coach panel

The panel headed **Coach** carries whatever your assistant writes with `annotate`, as it
types it. Nothing else writes there.

## Save the moment

**Save this moment** writes a note about the position on the board. The position is taken
on the server along with the game it is following and any line it has wandered into, so
the note is pinned to what was actually on the board and not to what this tab last
received. Write what is worth remembering and press **Save note**; it is then an ordinary
note — see [Notes](notes.md).

## The Session panel

**Session** names the game being followed or an ad-hoc position, the source it came from,
the ply and side to move, the last move, how many arrows and squares are drawn, and
whether the board has left the game it started from.
