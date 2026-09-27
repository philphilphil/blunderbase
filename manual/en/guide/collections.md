# Collections

A collection is a named, coloured group of games: a league season, the club's
over-the-board games, the losses you mean to go back to. A game can be in several at once,
and being in one hides it from nothing. A collection's games count in [Games](games.md), on
the dashboard, in [Statistics](stats.md) and in the [explorer](explorer.md) like every other
game; the collection is one more way to cut them, and Stats and the explorer can be narrowed
to it. A saved filter is a question asked again every time you open it. A collection is a
set of games that stays as you made it, and it is kept in the database, so it is the same on
every device and your [assistant](coach.md) can read it.

**Collections** in the rail, right under **Games**, opens this screen, and `⌘6` gets there
from anywhere.

## The cards

Each collection is a card, side by side as the window allows and one under the other on a
phone. Every card has the same parts in the same places, so cards next to each other line
up. A card shows:

- its colour and name, and how many games it holds;
- one line of description, blank if it has none;
- four figures over your games in it, from your side of the board: **Your score** (points
  out of games), **Results** (wins, draws and losses), **Avg opponent** (the average rating
  of your opponents) and **Blunders / game**. They count only games you have a side in, so a
  reference game in the collection, or one of yours whose side is not known yet (a PGN under
  a name that is no account), counts in the number of games but not in the score; pointing
  at the score says how many it left out. A figure with nothing behind it yet — no rated
  opponent, nothing analysed — shows a dash;
- the rule as small chips with **adds new imports** beside them, or **No rule · added by
  hand**;
- when the last game in it was played.

The switch over the cards turns them into a **Table**: one row per collection with the same
figures in columns, for when there are enough collections to compare them down a column.
The rule, the average opponent and blunders per game join the table on a wide window. A row
opens and edits its collection the way a card does. The switch is remembered in this
browser.

With no collection yet, the screen says what one is and offers **New collection**.

## Open a collection's games

Clicking a card opens [Games](games.md) with the **Collection** filter set to it and
**Whose games** on **All**, so the list holds every game the card counted, a reference game
you put in by hand included. It is the ordinary library from there: the other filters, the
search, sorting and the selection work as ever, **Mine** narrows it to your own games, and
**Clear** drops the collection with everything else.

**Stats** at the foot of a card (the chart icon at the end of a table row) opens [Statistics](stats.md#narrow-the-window) narrowed to
the collection.

A game in a collection also carries a chip in that collection's colour, in the **Flags**
column of the games list (on a phone, on the game's card) and in the bar over a game you
open; a long name is shortened to fit. Clicking a chip opens the same list as the card.

## Edit and delete

**Edit** at the foot of a card (the pencil at the end of a table row) opens the collection dialog for it: the name, the colour, the
description and the rule, as in [Make a collection](#make-a-collection). Under **Edit** the
dialog counts only the matching games not in the collection yet, which includes any you took
out by hand. **Delete…** is in the dialog too, and asks first; deleting a collection leaves
its games in the library.

## Make a collection

There are three ways in:

- **New collection** in the title bar of this screen, with nothing in it yet.
- **Make a collection** in the games list, beside **Save filter**. It appears once a filter
  a rule can hold is set: source, time control, speed, rated, colour, opponent or opening,
  and opens the dialog with the rule already filled in from those filters. The usual way to
  make one is to filter the list until it shows what the collection is, then press it. A
  league played at 45+45 on Lichess is **Source** Lichess, **Time control** `2700+45`
  (Lichess writes the clock in seconds) and rated, which keeps a casual 45+45 with a friend
  out. Saving shows the new collection's games in the list.
- **New collection from these N games…** in **Add to…**, with games ticked in the list; see
  [Add games by hand](#add-games-by-hand).

The dialog asks for a name, a colour and, if you like, a description. **Add new games that
match** turns the rule on, with **Source**, **Time control** (the exact clock, such as
`2700+45`), **Speed**, **Rated** (either, rated or casual), **Colour**, **Opponent** and
**Opening (ECO)**. Of the filters you had open, those a rule can hold come along; the date,
the result, the analysis chips and the search box do not, because a rule says what kind of
game belongs, not when it was played or how it went. Under the fields the dialog counts the
games you already have that match the rule, and the box beside the count adds them now.
Opened from **Make a collection** that box is already ticked. The count can be larger than
the list you were looking at, when that list was also narrowed by a date or a result.

## Add games by hand

In [Games](games.md#act-on-several-games-at-once), tick rows and press **Add to…** in the
footer. It is a checklist rather than a choice of one, because a game can be in several
collections: a ticked box means every selected game is in that collection, a half-ticked one
that only some are. Clicking an empty or half-ticked box puts the whole selection in, and
clicking a ticked one takes the whole selection out. **New collection from these N games…**
makes a collection that starts with exactly those games. On a game's own page the same
checklist is behind the **⋯**; see [Analysing a game](game.md#collections).

## When a rule runs

A rule looks at every game as it is stored — a sync, an automatic sync, the Lichess live
stream, an uploaded PGN, a game entered by hand — and puts it in every collection whose rule
it matches. It takes only your own games, so a model game you add to the library joins a
collection only by hand. A game whose side is not known when it arrives, such as a PGN under
a name that is no account yet, is asked again by the rules that name a colour once you add
that account and the side is known — but only by the rules that were already in place, as
they are now, when the game arrived. A rule you make or change after that takes such a game
only when you add the matching games from the dialog. A rule never goes back over the
library on its own.
Changing one touches none of the games already in the collection; the games already stored
join only when you tick the box that adds them now.

## Take games out

With the **Collection** filter set in the games list, ticked rows get **Remove from
collection** in the footer. That, or unticking the box in **Add to…**, takes games out, and
they stay out: the next sync does not bring them back, because the rule only looked at them
once, when they arrived. Only adding the matching games again, from the dialog, would.
Deleting a game takes it out of every collection it was in.
