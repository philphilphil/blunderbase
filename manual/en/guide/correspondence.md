# Correspondence

Everything else in Blunderbase is a record of a game that has been played. **Correspondence**
is the one being played: a move every few days, for months, on the ICCF server or anywhere
else that gives you that much time. The work is not the move list — it is the tree of
candidate moves behind it, which is what this screen keeps.

The mode is off until you switch it on under **Analysis → Correspondence**, see
[Analysis](analysis.md#correspondence). With it on, **Correspondence** sits in the sidebar
under **Live**; with it off there is no entry and the pages send you home.

## The list

Four sections, always in this order, the three lists of games with a count on each:

| Section | Holds |
|---|---|
| **Your move** | Games waiting on you, soonest deadline first |
| **Waiting for the opponent** | Your move is sent; nothing to do |
| **Running now** | Every engine on every game, one line each — see [Running now](#running-now) |
| **Finished** | The last few, each a link to the game in your library |

A row carries the two players and which colour is yours, the event, the move number and the
last move played, how many days are left before your reply is due — red under two, negative
when you are late — and the evaluation of the position the game stands in, from White's
point of view whichever colour you have. It also carries a chip per engine at work on that
game, with the depth or the node count it is at, so the list says at a glance where your
machine's attention is.

Under the heading is the **capacity strip**, and the title bar offers **New game**, **Import
PGN** and **Pause all**.

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
| **Reply due** | When your next move is due, as the server shows it. Blank is no deadline — Blunderbase never computes one, see [Enter the moves](#enter-the-moves) |

**Import PGN** takes the text the server exports — pasted into the box — and fills the same
fields from its headers: the moves become the played line, and `Event` and `Site` come from
the PGN unless you type over them. It is the quicker way in for a game already under way.

A game the library already holds is refused rather than stored twice — the same ICCF number,
or the same two names on the same day with the same moves.

## Enter the moves

Two buttons in the header move the game, and both take one move:

- **Opponent played…** enters the move that arrived.
- **Play this move** sends the move you have selected in the tree, and is the move you are
  making. It plays it on the board here; the server the game is on stays where you actually
  submit it.

The deadline is yours to type. The server the game is played on is the only clock there
is — ICCF banks days and adds an increment per move, other servers do it their own way —
and a number guessed here would sort **Your move** and the task queue by fiction. So when
the opponent's move arrives, read the date off the server's page and put it in the box in
the header; nothing is due until you do. When you play your move the deadline is cleared:
it was the deadline for that move, and while the opponent is thinking there is none.

**Take back the last move** undoes a move entered by mistake. The move stays in the tree with
its comments and everything analysed under it; it is only no longer part of the played line.

## The tree

The middle column, and the point of the screen. The played moves are the spine; every other
move you have entered hangs off the move it answers, indented under it. Play a move on the
board and it goes into the tree — if the branch is already there you walk into it, if it is
not it is added. Arrow keys walk the tree: left and right along a line, up and down across
the alternatives. Hovering a move shows its position on the board, with the tree's next
moves from there as arrows, and the selection stays where it was — so a line can be read
by running the pointer down it; click to make the position yours.

Each node shows its move, its evaluation and the evaluation its own branches back up:

- **Own** is what an engine says about that position.
- **Backed** is the best your tree can actually prove: the minimax over the children that
  have a number. When the two disagree the node shows both and an arrow saying which way —
  that gap is the whole point of keeping a tree. The engine's first choice refuted four
  moves deeper is exactly what an own eval above its backed eval means.
- An amber **≠** says two engines are more than half a pawn apart on this position, so the
  number under it is worth less than it looks.
- Beside them a node says what is happening to it: a **spinner** while an engine is on it, a
  **queue mark** while a task waits its turn, and a **stale mark** when the number shown was
  reached too shallow or by an engine you no longer have — see
  [Tasks and expansion](#tasks-and-expansion).
- A **note mark** says you have written about this position — notes, as distinct from the
  move comment, which is printed under the row itself. Select the move and the notes are
  under the board, see [Notes and the book](#notes-and-the-book).

Every number on these screens is White's, as an evaluation bar always is: `+0.41` means
White stands better whoever made the move, and `−0.30` after a Black move means Black
stands better. So a column read down the tree keeps its sign. What the colour of the backed
number says is about the mover: amber, the move was refuted further down — the line under
it is worse for the side that played it than the engine's own number promised; green, it
turned out better than it looked.

A node's own menu carries the verbs:

| Verb | |
|---|---|
| **Search with…** | Set an engine on this position, see [Search a position](#search-a-position) |
| **Queue task…** | One bounded look at this position, through the analysis queue, on the engine you pick, see [Tasks and expansion](#tasks-and-expansion) |
| **Expand…** | Make the best moves here into children and put a task under each |
| **Refresh subtree…** | Queue a task on every stale position from here down, on the engine you pick |
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

A move with lines under it carries a `−` at the end of its row; click it to fold those lines
away, and the `+` that takes its place says how many positions are hidden. The fold belongs
to the line, not to your browser: it is saved with the node, so the tree you tidied on one
machine is tidy on the next, and it still works on a finished game. A folded line opens by
itself while the position you have selected is inside it.

**Export PGN** writes the whole tree out: the played line as the mainline, every other node
as a variation under the move it answers, your comments as comments, your marks as NAGs and
each node's evaluation as `{[%eval 0.25]}` — the spelling Lichess uses, so any reader that
knows the convention shows the numbers. A starting position survives as a `FEN` header.

## Search a position

The right column is the engines: one pane per engine that is searching the selected node or
has already left a verdict on it, stacked one under the other. **Search with…** at the top
of the column puts another engine on the position.

The picker offers every engine that is switched on and speaks UCI, on this machine and on
your runners, with the one holding the deep role suggested. A search on a
[remote runner](../operate/runners.md)'s engine runs over there, holds one of that runner's
slots rather than one of this machine's search slots, and is read here exactly as a local
one. The ones a search cannot run on are greyed rather than hidden, and say why under the
pointer: a runner that is not connected, one whose link carries queue work but no search
(a browser tab, or a runner that fell back to polling), an engine that cannot drive a
board, and one whose binary has gone missing says where it was looked for. Maia is never
among them: one look and no search gives a spread of moves, not a line.

A runner's search survives the runner going away. The pane says **waiting for host**, the
row keeps its place, and when the runner reconnects the search starts again from its last
checkpoint — the process over there died with the link, so the hash is what is lost. Pause
on a runner is warm when the runner is current (the process is parked over there) and cold
on an older runner, which is closed and opened again on resume. A shortlist of moves needs
a current runner too; an older one refuses it and the pane says to update it.

Under the engine's name the search itself is set:

| | |
|---|---|
| **Lines** | How many candidate lines to keep, 1 to 5. Blank takes **Lines per search** from the settings |
| **Stop it at** | Where to stop: a number of **minutes** (it opens on an hour), a **depth** (45 when chosen), or a number of **nodes**. **Nothing** means the search runs until you stop it |

An hour is the default because a long search is the least productive way to spend an
engine. Each further ply costs about twice the last, so a day at one position buys three or
four plies beyond what an hour gave, and in most positions the number and the best move have
long since stopped moving. The same day spent on the positions at the end of the line and on
the opponent's other tries changes the tree far more — that is what [tasks](#tasks-and-expansion)
are for. **Nothing** is there for the few positions where the history under the engine
pane shows the number still moving between depths: a fortress the engine is slowly seeing
through, a sacrifice that only pays thirty plies on, an endgame near a tablebase.

A limit that is reached ends the search tidily: the last checkpoint is written, the process
quits, the slot goes back and a toast says the position is done, whether or not you are
looking at that game.

**Only the marked moves** in the same dialog hands the engine a list of the moves already
under this node, and it considers nothing else, so all of its time goes to the three candidates you actually care about. It restricts
this one search and changes nothing in the tree; the moves have to be legal in the position.
Its numbers stay in the pane and are never written into the tree: the best of a shortlist is
not the position's evaluation, and a stored one would be a number no later search could take
back. Use it to compare candidates you have already chosen, and an unrestricted search when
you want the position's own verdict.

One engine on one node has one search: asking the same engine again while it is queued,
running or paused there is refused, and a finished game takes no searches at all — its tree
is frozen.

Each search on this machine holds one of its **search slots** — two by default, under
**Compute → Machines** on this server's card — and each search on a runner holds one of
that runner's slots, shared with its queue work and never taken from a run already going.
With all of them busy a new search is **queued** and
starts by itself the moment one comes free. Searches have their own slots, so one that runs
for three days never takes the slot an imported game's quick pass is waiting for.

**Stockfish and Leela at the same time** is the point of the stack: two engines on the same
position, two slots, two live panes, two verdicts you can compare. Read Stockfish by its
depth and Leela by its node count — the pane shows both, because a Leela at depth 22 and a
Stockfish at depth 51 are not the same measure. Two Leela searches at once are two processes
on one GPU, each slower for it; nothing stops you, and
[Engines](../operate/engines.md#an-engine-for-correspondence) says what to weigh.

While it searches, a pane shows the depth, the nodes, the speed and how long it has been
going — counted from its last start, so a search resumed after a pause shows the stretch it
is in and not the days it stood parked — and its candidate lines with their evaluations,
twice a second; hovering a line draws it on the board. When it is not searching, the pane keeps what the engine last said: the
stored lines, the depth it reached, and a sparkline of how the number moved as the search
grew — a point at every new depth, and for an engine like Leela, whose depth stands still
for hours while its node count climbs, a point every time that count has grown
materially — which is how you tell an evaluation that has settled from one still walking.

Nothing waits for the end. What the engine has found is written into the tree as it goes, at
every new depth and at least once a minute, so closing the browser, shutting the lid or
restarting the server costs you the last minute at worst. A checkpoint only ever moves a
position forward: a short look never overwrites what a three-day search established.

When two engines have a verdict on one node, the tree reads the **deepest** of them, unless
you **pin** one — **Pin** in its pane, and the same button, then reading **Pinned**, hands
the node back to the deepest. The pin is per node, so you can trust Leela in the one position where you think it is right
without changing anything else. The amber **≠** on a node is the sign to read both panes
before believing either number.

## Tasks and expansion

A search is one engine thinking about one position for as long as you let it. A **task** is
the other half: a bounded look — forty million nodes by default, a minute or two — over one
position, queued into the ordinary analysis queue. It takes no search slot, so it never
stands in the way of a search, and it runs wherever the queue has room, including on a
[remote runner](../operate/runners.md). Which engine works it is chosen when it is queued,
from the same list the search picker shows — and here a runner's engine is not greyed,
because a task is ordinary queue work and the machine bought for correspondence is usually
that runner. The engine holding the deep role is suggested.

A node's menu carries both. **Queue task…** asks for one look at that position and which
engine should take it. **Expand…** is the one that does the work of an evening:

| | |
|---|---|
| **Engine** | Every task of the expansion runs on it, the later stages included, however many hours they take |
| **Width** | How many moves each stage keeps — the first moves of the position's best lines, strongest first. Blank takes **Lines per task** from the settings |
| **Stages** | How many levels deep to go, 1 to 3. Width 3 and 2 stages is up to twelve positions; width 3 and 3 stages is up to thirty-nine |
| **Queue tasks** | On, each new move gets an engine. Off, the moves go into the tree and nothing is calculated |

Expanding a node the engines have already judged makes the children at once and queues a
task under each; one that nobody has looked at yet gets a single task carrying the whole
expansion, which unfolds by itself when that task answers. Either way you can close the
browser: the expansion lives on the queued rows and not in the page. **Expand…** above the
tree does the same for the position you have selected, without going through the menu.

Tasks go into the queue ahead of the automatic pass every imported game gets and behind a
deep pass you are sitting and waiting for, and among themselves **the nearest deadline is
worked first** — one game due tomorrow comes out of the queue before one due next week,
however they were queued. A node with a task waiting on it carries a queue mark; one being
worked on carries a spinner. **Cancel** takes a waiting task back out of the queue; one an
engine has already started finishes. **Clear the queue** on the
[Analysis](analysis.md#what-is-left-to-analyse) page empties it of tasks as well, and each
node whose task went with it says why it stopped. A task whose machine goes away mid-search
— the process killed, a remote host unplugged — goes back into the queue by itself and is
tried once more; if that fails too the node is marked failed with the reason on it and is
free to be given a new task.

Your **marks** steer all of it, which is the reason to make them:

| Mark | What an expansion does with it |
|---|---|
| **✕ Excluded** | Never expanded, never given a task, and everything under it is skipped too |
| **? Bad** | One stage at most, however deep the expansion around it goes |
| **! Good**, **!? Interesting** | One stage more and one sibling more than its neighbours |
| No mark | The width and the stages you asked for |

**Refresh subtree…** in the same menu is the maintenance verb. A verdict is **stale** when it
is shallower than **Stale below depth** — thirty by default — or when it was written by a
version of the engine that is no longer installed, which is the one people forget: a
Stockfish upgraded in January makes every verdict from December somebody else's. Stale
verdicts are marked on the tree, and **Refresh subtree…** queues a task on every stale
position from that node down, holes in the branch included. It refuses, and says how many
it found, when there are more than fifty: refresh a branch at a time rather than a whole
game's tree at once.

## Pause, stop and what survives

Every pane carries **Pause** and **Stop**, and they are not the same thing:

| | |
|---|---|
| **Pause** | The slot goes back at once, the process stays. It is parked with its hash intact, so **Resume** — which takes the next free slot — picks up where it stopped, in seconds rather than hours. A parked engine costs the memory of its `Hash` and no CPU |
| **Stop** | The search ends and the process quits. The memory comes back and the row is closed: a stopped search is not resumed, you start a new one, and that one begins cold |

The pause takes effect immediately; the pane says *parked, warm* a moment later, when the
engine has actually been put aside. The capacity strip counts what is parked and how much it
holds, which is how you decide when parked is too much.

A **restart** — of the server, the container, the machine — is the third case. Searches that
were running start again by themselves once the server is up, provided their engine is still
configured; the rest come back paused, with the reason on the row. No process survives a
restart, so every search is cold — a pane that reads *paused, cold* instead of *parked,
warm* is one whose engine has been put down: the engine starts from the depth of its last checkpoint
and needs roughly as long to reach its old depth as it did the first time, because the last
iterations are where the time goes.

What survives all three, always, is the tree — the evaluation, the depth, the node count,
the lines and the history on every node it had reached. A pause keeps the engine's hash
table; a stop and a restart lose it. That is time, not knowledge.

A search that fails — a binary that has gone, an engine that died mid-search — is marked
failed and keeps its error on the pane. The tree keeps every checkpoint it had made until
then.

## Running now

Back on the list page, between **Waiting for the opponent** and **Finished**, is every
engine on every game, one card each: the engine and the host it runs on, the game it is
working for, the evaluation it is at, the depth and the node count, and how long it has been
going. A parked search is in the list too, greyed and marked warm, and so is one waiting for
a slot. Each card is a link into the game it belongs to.

**Tasks are in the list as well**, marked `task`: one card per task that is waiting or being
worked on, with the engine, the machine that engine lives on and the node budget it was
queued with. A task streams nothing while it waits, so it carries no depth — what it can say
about its size is what it will spend.

The **capacity strip** under the page heading counts the same work over the whole
installation: search slots in use of the slots this machine has, searches waiting for one,
engines parked warm and the memory they hold, how many tasks are out and how many of them
an engine has already, and a line per remote host. Tasks are counted beside the slots rather
than against them: they hold none. The same figures
sit along the foot of the sidebar, so they are answered from every screen. Both the strip
and the list follow the searches as they report — there is no page here to refresh.

## Pause all

**Pause all** in the title bar is for the moment the laptop closes or the machine is wanted
for something else. It pauses every search on every game, warm exactly as pausing one is,
and turns into **Resume all**, which sets them all going again: each takes a slot as one
comes free. A paused search whose engine has since been switched off or removed stays
paused, and says so.

Neither is destructive. The tree keeps what every search had checkpointed, and searches
resumed while their processes are still parked come back at the depth they stopped at.

## Notes and the book

Under the board, three tabs about the node you have selected:

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
A move whose position has notes carries a note mark in the tree, so what you wrote weeks
ago is found again when the game walks back into it. Notes can still be written on a game
that is over; the move comment cannot, because it belongs to the frozen tree, and a finished
game shows it as text instead.

## Finish a game

**Finish…** asks for the result — `1-0`, `0-1` or `½-½` — and, if you want it, how it ended
(resignation, adjudication, time). Then:

- The quick and the deep pass are queued over the game, as for any game that arrives. A
  deployment with no engine in a role queues nothing for it and says so; the game still
  finishes, and you can ask for the pass later.
- The deadline is cleared and the game leaves **Your move**.
- The tree freezes. It is kept with the game and stays readable, but nothing in it can be
  changed again, and it takes no new searches and no new tasks.
- A search still running on the game is not stopped for you — it is your engine time to
  spend. **Stop** it in its pane when the game is over.

From there it is a library game like any other: on the evaluation graph, in **Games** under
its source and the correspondence time control, and in the statistics. Its game page keeps a
**Correspondence tree** button in the title bar, which opens the frozen tree beside the
finished game — see [Analysing a game](game.md#the-correspondence-tree).
