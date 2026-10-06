# Notes

## What does a note stick to?

A position, not a move number. Write one with `N` on the game screen and it comes back in
every game of yours that reaches that position, whatever the move order was. A note can
carry tags, and a note written while walking a model game or a reference line is still
yours and is kept.

Or to a game entire, with no position at all: the *game* row at the top of the game
screen's **Notes** tab (`⇧N`), or **This game** in a correspondence game. Those come back under
that one game only — see [Analysing a game](game.md#write-a-note).

Wherever a note is written — the game screen, the explorer, the live board, a
correspondence game, the notes page — **Enter** saves it and **Shift+Enter** starts a new
line. A box that saves when you click away still does.

## Where do they show up?

Under the board of any game that reaches the position, in **Your notes on this position**
in the explorer, and on the live board. The move column marks a move whose position has
been written about, so a game you have thought about before says so; point at a marked move
to read the note. A move without a note shows no tooltip.

## The notes page

**Notes** collects everything you and your assistant have written, newest first, under a
line for each stretch of time (*Earlier this month*, *August 2026*).

The row over the list starts with the view switch. **Stream** shows every note in full,
two to a row; **Sheet** a grid of positions with the text clamped; **List** one line per
note with where it came from: the move, the opponent and their rating, the result and, in
a window 1440 pixels wide or more, when the game was played and the tags. The page
remembers the view you picked.

After it come the filters, each a button that opens a small panel: **Tags**, **About**
(what the note is pinned to), **Opponent** and **Result** of the game it was written on,
**Game**, **Written** (when) and **Written by** (you in the app, your assistant over MCP,
or the live board). A filter that is set turns blue and reads *Tags: endgame*; its **×**
clears it, and **Clear** clears them all. The **Filter notes…** box at the end of the row
searches the words of the notes themselves.

On a note, the small grey words at the top (*game*, *loose*, *via MCP*, *28d ago*) only
say what it is. The tags under the text (*#endgame*) are buttons: click one to see only
notes with that tag. The pencil rewrites the note and the bin deletes it, after asking. At
the foot, **Written on …** opens the game at that move, and **In 3 games of yours** opens
the position in the explorer. In the list, click a line to open the whole note in place,
and click an opponent's name to see only notes on games against them.

## Export notes

**Export** at the top right exports everything the current filters show. Pick
**Markdown** for a file to read, or **PGN** for a file a chess program opens, in which
notes are comments and saved lines are variations. The button is greyed out while no note
matches.
