# Statistics

## What do the reports show?

**Stats** shows one report at a time, chosen in the rail:

| Report | Answers |
|---|---|
| **Overview** | phase, time control, time trouble, progress |
| **Blunder taxonomy** | where blunders happen and what moves them |
| **Clock behaviour** | time trouble and time of day |
| **Progress** | rating over the window |

The rating a game carries is the one you had when it ended. Lichess and chess.com both say
what a game did to your rating, and a PGN that carries `WhiteRatingDiff` tags does too, so
each point on the Progress line already includes that game's result. A casual game, or a
PGN without those tags, keeps the rating you brought to it.

## Which games are counted?

Your own games, and only those an engine has been over — the **Games** tile says how many
of the games in the window are analysed. Games marked as not yours count in nothing.
If a report looks thin, check **Analysis → Coverage**.

## Narrow the window

Four controls sit above the report: **Window** (7 days, 30 days, 90 days, a year or all
time), **Colour**, **Speed** and **Collection**. **vs previous** shows every number against
the equally long window before this one; all time has nothing to compare against.
A game with no date, such as a PGN whose `Date` is `????.??.??`, counts under all time and
in no shorter window.

**Collection** appears once you have made a [collection](collections.md). It is
**All games** unless you pick one; then every number on the report is over your games in
that collection alone, which is how a league season gets statistics of its own. A reference
game you put in a collection by hand counts here no more than anywhere else in Stats. The
**Stats** link on a collection's card ([Collections](collections.md#open-a-collections-games))
opens the report with it already picked, and the
choice stays in the page's address, also when you switch reports in the rail. Without a
collection picked, a collection's games count
here like every other game: a collection narrows Stats, it never takes games out of it.

## Export as CSV

**Export CSV** downloads the report you are looking at, cut the way you cut it.
