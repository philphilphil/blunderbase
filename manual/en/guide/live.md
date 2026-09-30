# Live

## What is the live board?

A board nothing in the app drives. **Live** shows whatever an MCP client has put on it, so
you and the assistant reading your library look at the same position while you talk about
it. Until something is put there it is empty; the rail marks it **on air** while a session
is running, and so does the line above the board, with a green dot. **Flip** turns it round
for you only.

The title bar says whether this page is hearing the board: **live** with a green dot,
**connecting** in amber, or **offline — retrying** in red. **Reset** clears the board. When
your assistant has put up several positions, **Prev** and **Next** step between them.

## Put something on it

Ask your assistant for it. `show_game` puts a stored game on the board, `show_position` a
FEN. It can draw arrows and colour squares as it goes, and step the game on move by move.
Connecting a client in the first place is [Your AI assistant](coach.md).

## The Coach panel

The panel headed **Coach** carries whatever your assistant writes with `annotate`, as it
types it. Nothing else writes there.

## Save the moment

**Save this moment…** writes a note about the position on the board. The position is taken
on the server along with the game it is following and any line it has wandered into, so
the note is pinned to what was actually on the board and not to what this tab last
received. Write what is worth remembering and press **Save note**; it is then an ordinary
note — see [Notes](notes.md).

## The Session panel

**Session** names the game being followed or an ad-hoc position, the source it came from,
the ply and side to move, the last move, how many arrows and squares are drawn, and
whether the board has left the game it started from.
