# Games

## Filter the list

The segmented control at the left of the filter bar picks **Mine**, **Others** or **All** —
your own games, the ones added from the reference books, or both. The chips beside it each
own one group:

| Chip | Narrows by |
|---|---|
| **Date** | Played from and until, with 7d, 30d, 90d and 12m presets |
| **Source** | Lichess, Chess.com, FICS, OTB, PGN, ICCF or Masters |
| **Colour** | The side you had |
| **Result** | Your result (win, loss, draw) or the PGN result (1-0, 0-1, ½-½) |
| **Opening** | An ECO code, or a prefix — `C6` is every Caro-Kann from C60 to C69 |
| **Time control** | A speed, an exact clock such as `600+0`, and rated, casual or either |
| **Opponent** | Part of a name |
| **Analysis** | Contains a blunder, any analysis done |
| **Collection** | One of your [collections](#collections), each listed with its count |

The line above the table says how many games match. **Clear** next to it drops every chip
at once, and a chip's own clear drops just that group.

In the table, the **Source** column names the site beside a coloured dot. On a Lichess or
Chess.com row it is a link, with a small arrow when you point at it: it opens the game on
that site in a new tab, without opening the row here. A PGN you uploaded keeps the link too
when the file came from one of those sites. FICS, OTB and typed correspondence games have
no page anywhere, and their source is just a name.

## Search the table

`/` puts the cursor in the search box, which matches an opponent, an ECO code and the text
of the PGN. **Esc** takes the cursor back out and leaves the search as it is.

## Save a filter

**Save filter** names the current filter and puts it in the rail under **Games**, with its
count beside it. Two come with the app: **Losses as black** and **Blunders**. Hovering one
you saved shows the × that forgets it.

## Collections

A collection is a named, coloured set of games: a league season, the club's over-the-board
games, the losses you mean to go back to. A game can be in several at once, and being in one
hides it from nothing. A collection's games count in this list, on the dashboard, in
[Statistics](stats.md) and in the [explorer](explorer.md) like every other game; the
collection is one more way to cut them, and Stats and the explorer can be narrowed to it. A
saved filter is a question asked again every time you open it. A collection is a set of
games that stays as you made it, and it is kept in the database, so it is the same on every
device and your [assistant](coach.md) can read it.

### In the rail

The **Collections** fold sits under **Games**, below the saved filters: each collection with
its colour, its name and how many games it holds. Clicking one opens its page, and **+**
starts a new one.

### On the rows

A game in a collection carries a chip in that collection's colour in the **Flags** column,
ahead of the move flags, one chip per collection; a long name is shortened to fit the
column. On a phone the chips are on the game's card.

### Add games by hand

Tick rows and press **Add to…** in the footer. It is a checklist rather than a choice of one,
because a game can be in several collections: a ticked box means every selected game is in
that collection, a half-ticked one that only some are. Clicking an empty or half-ticked box
puts the whole selection in, and clicking a ticked one takes the whole selection out.
**New collection from these N games…** makes a collection that starts with exactly those
games.
On a game's own page the same checklist is behind the **⋯**; see
[Analysing a game](game.md#collections).

### A collection's page

A collection's page is this same list narrowed to it (`/games?collection=…`), so the filter
chips, the search, sorting, paging and the selection all work as ever, and the address is a
link. The titlebar names it after **Games**, with its colour, and carries **Edit** and
**Stats** where the library has **Import**; **Stats** opens
[Statistics](stats.md#narrow-the-window) narrowed to the collection. Above the filters the page
carries what a filter alone cannot give you:

- its description, if it has one;
- a score line over your games in the collection, from your side of the board: points out of
  games, wins, draws and losses, the average rating of your opponents and blunders per game.
  It scores only games you have a side in, so a reference game in the collection, or one of
  yours whose side is not known yet (a PGN under a name that is no account), is listed but
  not scored;
- the rule, if it has one, as small chips with **adds new imports** beside them.

With rows ticked, the footer here also offers **Remove from collection**. Unlike the rest of
the list the page starts on **All**, so it lists every game the rail counts, a reference game
you put in by hand included; **Mine** and **Others** narrow it as they do anywhere else.

### Make a collection

**Make a collection** appears beside **Save filter** once a filter a rule can hold is set:
source, time control, speed, rated, colour, opponent or opening. It opens the collection
dialog with the rule already filled in from those filters. The usual way to make one is to
filter the list until it shows what the collection is, then press it. A league played at
45+45 on Lichess is **Source** Lichess, **Time control** `2700+45` (Lichess writes the clock
in seconds) and rated, which keeps a casual 45+45 with a friend out. With no such filter set,
start a collection from the **+** in the rail, or from **Add to…** with games ticked.

The dialog asks for a name, a colour and, if you like, a description. **Add new games that
match** turns the rule on, with **Source**, **Time control** (the exact clock, such as
`2700+45`), **Speed**, **Rated** (either, rated or casual), **Colour**, **Opponent** and
**Opening (ECO)**. Of the filters you had open, those a rule can hold come along; the date,
the result, the analysis chips and the search box do not, because a rule says what kind of
game belongs, not when it was played or how it went. Under the fields the dialog counts the
games you already have that match the rule, and the box beside the count adds them now.
Opened from **Make a collection** that box is already ticked. The count can be larger than
the list you were looking at, when that list was also narrowed by a date or a result. Under
**Edit** it counts only the matching games not in the collection yet, which includes any you
took out by hand.

**Edit** on a collection's page opens the same dialog. **Delete…** is in it too, and asks
first; deleting a collection leaves its games in the library.

### When a rule runs

A rule looks at every game as it is stored — a sync, an automatic sync, the Lichess live
stream, an uploaded PGN, a game entered by hand — and puts it in every collection whose rule
it matches. It takes only your own games, so a model game you add to the library joins a
collection only by hand. A game whose side is not known when it arrives, such as a PGN under
a name that is no account yet, is asked again by the rules that name a colour once you add
that account and the side is known. A rule never goes back over the library on its own.
Changing one touches none of the games already in the collection; the games already stored
join only when you tick the box that adds them now.

### Take games out

**Remove from collection** on the collection's page, or unticking the box in **Add to…**,
takes games out, and they stay out: the next sync does not bring them back, because the rule
only looked at them once, when they arrived. Only adding the matching games again, from the
dialog, would. Deleting a game takes it out of every collection it was in.

## Sort and page

Click a column header to sort by it, and again to turn it round. The sort applies to the
whole filtered library, not to the page in front of you. The footer sets the rows per page
— **Fit** is as many as the window has room for — and pages with the arrows beside the
count.

The **Analysis** column says **Analysed** or **Unanalysed** in plain words, in purple when
a run you asked for is among them. The only badges in the table are the `??`, `?` and `?!`
flags. The **Worst** column is coloured only when the drop is an inaccuracy or worse.

## Read the list without the engine

`⇧E`, or the computer in the title bar, drops the **Worst** column and the flag badges from
every row, so the table says what you played and not how well. A list left sorted by
**Worst** falls back to newest first while it is on. The **Analysis** filter chips still
work — a question you asked is not an answer you were handed — and the button that queues
analysis is still there on a game nothing has looked at. The whole of the mode is under
[Settings](settings.md#hide-the-engine).

A row that shows an eye in the **Worst** column, with the rest of the table as ever, is a
game that was imported with its engine held back
([Analysis](analysis.md#hide-the-engine-on-new-games)); open it and press **Show the
engine** when you have read it.

## Act on several games at once

Tick rows, or the box in the header for the whole page — a ticked row turns blue, with a
bar down its left edge — and the footer offers **Add to…**, **Queue analysis**, **Delete**
and **Clear selection**. **Add to…** puts them in a collection, see
[Add games by hand](#add-games-by-hand). **Queue analysis** gives each game the
import pass, at the budget and in the place in the queue every imported game gets; a
deeper look at one game is **Analyse** on the game itself. What a pass costs is in
[Analysis](analysis.md#which-pass-does-a-game-get).

## Delete games

The ✕ at the end of a row, or a selection and **Delete**. The confirmation names the count,
because a game goes with its analysis, the notes written about it and the lines kept off
it. Notes about a *position* stay. There is no undo, and the deletion is recorded so a
later sync cannot bring the game back; forgetting that record is
[Library → Manage](library.md#manage).

## Share a filtered list

The filters live in the address, so any cut of the library is a link you can send or
bookmark. Which page you are on and how many rows you asked for do not.
