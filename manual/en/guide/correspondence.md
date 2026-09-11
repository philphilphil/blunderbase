# Correspondence

Everything else in Blunderbase is a record of a game that has been played. **Correspondence**
is the one being played: a move every few days, for months, on the ICCF server or anywhere
else that gives you that much time. The work is not the move list — it is the tree of
candidate moves behind it, which is what this screen keeps.

The mode is off until you switch it on under **Analysis → Correspondence**, see
[Analysis](analysis.md#correspondence). With it on, **Correspondence** sits in the sidebar
under **Live**; with it off there is no entry and the pages send you home.

## The list

Three sections, always in this order, with a count on each:

| Section | Holds |
|---|---|
| **Your move** | Games waiting on you, soonest deadline first |
| **Waiting for the opponent** | Your move is sent; nothing to do |
| **Finished** | The last few, each a link to the game in your library |

A row carries the two players and which colour is yours, the event, the move number and the
last move played, how many days are left before your reply is due — red under two, negative
when you are late — and the evaluation of the position the game stands in, from White's
point of view whichever colour you have. The title bar offers **New game** and **Import
PGN**.

## Start a game

**New game** asks for what a correspondence game is:

| Field | |
|---|---|
| **White**, **Black** | The names, spelled as the server spells them |
| **You are** | White or Black. Required: whose move it is and every deadline are counted from it |
| **Event** | The tournament, written into the PGN's `Event` header |
| **Link** | The game's page on the server, kept as `Site` |
| **ICCF id** | The game number. With one the game's source is **ICCF** and the number identifies it; without one it is a manual game and otherwise identical |
| **Time control** | Free text, as the tournament states it — `10 days/move`, `40 days/10 moves` |
| **Starting position** | A FEN, for a thematic tournament. Blank is the ordinary array |
| **Days per move** | The reply window this game is given. Blank takes the default from the settings |
| **Reply due** | When your next move is due, if you already know. Left blank, a game that starts on your move gets a deadline of today plus days per move |

**Import PGN** takes the text the server exports — pasted into the box — and fills the same
fields from its headers: the moves become the played line, `Event` and `Site` come from the PGN unless
you type over them, and when it lands on your move you get a deadline computed from days per
move. It is the quicker way in for a game already under way.

A game the library already holds is refused rather than stored twice — the same ICCF number,
or the same two names on the same day with the same moves.

## Enter the moves

Two buttons in the header move the game, and both take one move:

- **Opponent played…** enters the move that arrived.
- **Play this move** sends the move you have selected in the tree, and is the move you are
  making. It plays it on the board here; the server the game is on stays where you actually
  submit it.

When it becomes your move the deadline is set to now plus the game's days per move; while
the opponent is thinking there is no deadline. The deadline itself is editable in the
header; days per move is fixed when the game is created, so changing the default in the
settings later leaves games already under way alone.

**Take back the last move** undoes a move entered by mistake. The move stays in the tree with
its comments and everything analysed under it; it is only no longer part of the played line.

## The tree

The middle column, and the point of the screen. The played moves are the spine; every other
move you have entered hangs off the move it answers, indented under it. Play a move on the
board and it goes into the tree — if the branch is already there you walk into it, if it is
not it is added. Arrow keys walk the tree: left and right along a line, up and down across
the alternatives.

Each node shows its move, its evaluation and the evaluation its own branches back up:

- **Own** is what an engine says about that position.
- **Backed** is the best your tree can actually prove: the minimax over the children that
  have a number. When the two disagree the node shows both and an arrow saying which way —
  that gap is the whole point of keeping a tree. The engine's first choice refuted four
  moves deeper is exactly what an own eval above its backed eval means.
- An amber **≠** says two engines are more than half a pawn apart on this position, so the
  number under it is worth less than it looks.

Both numbers are written from the point of view of the side that played the move, the way a
variation is read: `15.Bd3 +0.41` means White stands better. The bar beside the board and
the list's own column are White's instead, as an evaluation bar always is.

A node's own menu carries the verbs:

| Verb | |
|---|---|
| **Comment** | Your note on the move; it goes into the PGN as a comment |
| **Mark** | Your verdict on the move, below |
| **Promote to first** | Make this the first of its alternatives, so it reads as the main one |
| **Delete subtree** | Forget this move and everything under it. The root and a move the game actually played cannot be deleted |

Marks are your word, not the engine's, and each has a glyph:

| Mark | Glyph |
|---|---|
| Good | `!` |
| Interesting | `!?` |
| Dubious | `?!` |
| Bad | `?` |
| Excluded | `✕` |

Lines the game has left — the alternatives to a move the opponent did not play — are greyed
rather than removed. They cost nothing, they are the record of what you looked at, and
**Delete subtree** is there when a branch is genuinely dead.

**Export PGN** writes the whole tree out: the played line as the mainline, every other node
as a variation under the move it answers, your comments as comments, your marks as NAGs and
each node's evaluation as `{[%eval 0.25]}` — the spelling Lichess uses, so any reader that
knows the convention shows the numbers. A starting position survives as a `FEN` header.

Nothing on this screen starts an engine yet. Searching a position, the engine panes beside
the tree, pausing them and what survives a restart arrive with the next step, and get their
own heading in this chapter then.

## Notes and the book

Bottom right, three tabs about the node you have selected:

- **This position** — notes pinned to the position the selected node stands in, so they come
  back in any game of yours that reaches it, and in the explorer. The node's **comment** —
  the remark that travels into the exported PGN — is edited above them.
- **This game** — the journal: what the opponent tends to do, the plan, the deadline
  arithmetic. Pinned to the game and to no move.
- **Book** — what is already known about this position, from either of two books:
  **Masters**, the same database as the [Explorer](explorer.md)'s reference source, which
  needs the Lichess token stored there; and **Your games**, your own tree from this position.
  Hovering a row draws it on the board, and clicking one puts that move into the tree —
  walking into the branch if you already have it, adding it if you do not. It is how the
  opening phase is played here: read the theory and keep what you read, in one click.

The first two are the notes described in [Notes](notes.md), written with the same composer.
Notes can still be written on a game that is over; the move comment cannot, because it
belongs to the frozen tree, and a finished game shows it as text instead.

## Finish a game

**Finish…** asks for the result — `1-0`, `0-1` or `½-½` — and, if you want it, how it ended
(resignation, adjudication, time). Then:

- The quick and the deep pass are queued over the game, as for any game that arrives. A
  deployment with no engine in a role queues nothing for it and says so; the game still
  finishes, and you can ask for the pass later.
- The deadline is cleared and the game leaves **Your move**.
- The tree freezes. It is kept with the game and stays readable, but nothing in it can be
  changed again.

From there it is a library game like any other: on the evaluation graph, in **Games** under
its source and the correspondence time control, and in the statistics. Its game page keeps a
**Correspondence tree** button in the title bar, which opens the frozen tree beside the
finished game — see [Analysing a game](game.md#the-correspondence-tree).
