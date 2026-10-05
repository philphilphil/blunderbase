# Games

The title bar says which list you are reading: **Games** for the whole library,
**Games › Losses as black** for one of your saved filters, **Collections › League 2026**
for a collection pinned in the rail, and **Games (filtered)** for any other filter.
**Import games** at its right end goes to [Library › Import](library.md).

## Filter the list

The segmented control at the left of the filter bar picks **Mine**, **Others** or **All** —
your own games, the ones added from the reference books, or both. After the thin rule
beside it, each picker owns one group. A picker reads its name, or its name and value
("Result: loss") once it is set; a set picker turns blue and gets a × of its own.

| Picker | Narrows by |
|---|---|
| **Date** | Played from and until, with Today, 7d, 30d, 90d and 1y presets |
| **Source** | Lichess, Chess.com, FICS, OTB, PGN, ICCF or Masters |
| **Colour** | The side you had |
| **Result** | Your result (win, loss, draw) or the PGN result (1-0, 0-1, ½-½) |
| **Opening** | An ECO code, or a prefix — `C6` is every Caro-Kann from C60 to C69 |
| **Time control** | A speed, an exact clock such as `600+0`, and rated, casual or either |
| **Opponent** | Part of a name |
| **Analysis** | Contains a blunder, any analysis done |
| **Collection** | One of your [collections](collections.md), each listed with its count |

The footer says how many games match. **Clear** at the right end of the filter bar, with
the number of filters set, drops every one at once, and a picker's own × drops just that
group.

In the table, the **Source** column names the site beside a coloured dot. On a Lichess or
Chess.com row it is a link, with a small arrow when you point at it: it opens the game on
that site in a new tab, without opening the row here. A PGN you uploaded keeps the link too
when the file came from one of those sites. FICS, OTB and typed correspondence games have
no page anywhere, and their source is just a name.

### Filter by collection

**Collection** narrows the list to one [collection](collections.md) like any other picker
does: the other pickers narrow inside it, and **Clear** drops it with the rest. Picking a
collection sets the control at the left to **All**, so the list holds every game in it and
matches the count beside its name; set it back to **Mine** for only your own games in it.
A card on the [Collections](collections.md#open-a-collections-games) screen, a collection
pinned in the rail, or a collection's chip on a row, opens the list the same way. While
the list shows exactly one collection and nothing else, the title reads
**Collections › its name**, and **Edit collection…** beside **Import games** opens the same
dialog as the collection's card ([Edit and delete](collections.md#edit-and-delete)); any
further filter makes it **Games (filtered)** again.

## Search the table

The **Filter games: opponent, ECO, PGN…** field at the right end of the filter bar matches
an opponent, an ECO code and the text of the PGN. `/` puts the cursor in it from anywhere
on the screen; **Esc** takes the cursor back out and leaves the search as it is.

## Save a filter

**Save filter…**, beside the search field, names the current filter and puts it in the
rail under **Games**, with its count beside it. It stays greyed out until a filter is set,
since there is nothing to save yet. Two come with the app: **Losses as black** and
**Blunders**. Hovering one
you saved shows the × that forgets it. Picking one, there or from `⌘K`, keeps the order
you had the table in, and it stays highlighted however you sort or page it.

## Sort and page

Click a column header to sort by it, and again to turn it round; the sorted one carries an
arrow. The sort applies to the whole filtered library, not to the page in front of you.
**Rows** in the footer sets the rows per page — **Fit** is as many as the window has room
for — and the ‹ › beside it page through, around the page you are on. Where the window is
too narrow for every column, the table scrolls sideways, and a fade on its right edge says
there is more.

The **Analysis** column says **Analysed** in plain words, in purple when a run you asked for
is among them. For a game nothing has analysed it holds **Analyse**, which queues its pass;
once the game is waiting in the queue or being analysed, it reads **In queue** instead. The
only badges in the table are the `??`, `?` and `?!` flags. The **Worst** column is coloured
only when the drop is an inaccuracy or worse.
**Notes** counts the notes written on a game — on the game itself, its moves and its pinned
lines; a note from another game that reached the same position is not counted. Sort by it
to find the games you annotated.
The last column, **Collections**, names the collections a game is in, separated by commas;
it is there only once you have made a collection.

## Read the list without the engine

`⇧E`, or the **Hide engine** switch in the title bar, drops the **Worst** and **Flags**
columns from the table, so it says what you played and not how well. A list left sorted by
**Worst** falls back to newest first while it is on. The **Analysis** filter still
works — a question you asked is not an answer you were handed — and **Analyse**, which
queues a game nothing has looked at, is still there on its row. The whole of the mode is under
[Settings](settings.md#hide-the-engine).

A row that shows an eye in the **Worst** and **Flags** columns, with the rest of the table as ever, is a
game that was imported with its engine held back
([Analysis](analysis.md#hide-the-engine-on-new-games)); open it and press **Show the
engine** when you have read it.

## Act on several games at once

Tick rows, or the box in the header for the whole page — a ticked row turns blue, with a
bar down its left edge, and the header box shows a dash while only some are ticked. The
footer then says how many are selected and offers, in this order, **Clear selection**,
**Add to**, **Queue analysis** (the one filled button) and, set apart, **Delete…**.
**Add to** puts them in a collection or takes them out, see
[Add games by hand](collections.md#add-games-by-hand); with the **Collection** filter set,
**Remove from collection** takes them out of that one, see
[Take games out](collections.md#take-games-out). **Queue analysis** gives each game the
import pass, at the budget and in the place in the queue every imported game gets; a
deeper look at one game is **Analyse…** on the game itself. What a pass costs is in
[Analysis](analysis.md#which-pass-does-a-game-get).

## Delete games

The bin at the end of a row, which shows when you point at the row, or a selection and
**Delete…**. The confirmation names the count,
because a game goes with its analysis, the notes written about it and the lines kept off
it. Notes about a *position* stay. There is no undo, and the deletion is recorded so a
later sync cannot bring the game back; forgetting that record is
[Library › Manage](library.md#manage).

## Share a filtered list

The filters live in the address, so any cut of the library is a link you can send or
bookmark. The sort and the page you are on go into it too, which is why going back from a
game — with Back or with the crumb in its title bar — lands on the same page in the
same order. How many rows you asked for does not: that
stays a setting of your own browser.
