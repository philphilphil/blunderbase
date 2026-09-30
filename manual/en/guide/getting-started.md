# Getting started

## Sign in for the first time

A fresh installation asks you to choose the owner's password. There is one owner and one
password. From then on the sign-in page wants only that password, and the session stays
in the browser until you sign out. If nothing is running yet, start with
[Install](../operate/install.md).

## Find your way around

The rail down the left side is the app. At the top are the name (and, on the public demo,
a **Demo** tint that leads to blunderbase.org) and **Search everything**, which opens the
command palette, as `⌘K` does anywhere. Under it come the pages, and under Collections
the collections you [pinned](collections.md). The one row with a pale grey pill and blue text is where you
are. When that is a page inside an entry, such as **Import** under Library, the entry
above it stays plain, and pointing at a row only brightens its text. `⌘1` to `⌘6` open the
first pages; a row's tooltip names its key. The button at the end of the name row folds
the rail to icons; folded, pointing at the logo turns it into the button that unfolds it.

The foot of the rail lists your engines, one per line, each with a dot: green when it is
enabled, grey when it is not. Any of them leads to **Compute › Engines**. With
[correspondence](correspondence.md) on and a search running, a **Correspondence** line
under them shows the searches in use out of the slots (`1/2`), and pointing at it lists
the rest. Last comes **Settings**, which opens the settings menu upwards, and the
connection dot: green while the app is live, orange while it connects, red while it is
offline.

The bar across the top belongs to the page. It shows the page's title, with the places
above it as links (`Library › Import`), then the page's own buttons on the right, then the
analysis queue (`Idle 0/0`, or a spinner and a meter while it works, with **Pause** and
**Clear** beside it while there is something to pause or clear), and last the **Hide
engine** switch ([Hide the engine](settings.md#hide-the-engine)). On a
phone the rail is behind the ☰ and slides in with the same contents. A page opened from
a list, such as a game, shows `‹ Games` instead of the ☰ to take you back. The page's
buttons move to a row under the bar.

## Register your engines

Open **Compute › Engines** and add Stockfish, and Maia if you want human-move predictions. Give
each job an engine. Nothing is analysed until you do. Where the binaries come from is in
[Engines](../operate/engines.md).

## Import games

Open **Library › Import**, type your username into the Lichess, chess.com or FICS box and
press **Connect**. Or drop a PGN file anywhere in the window. Both are covered in
[Library](library.md#import).

## What happens automatically

Every game that arrives is queued for a Stockfish pass, so evaluations fill in
behind a sync. The [Dashboard](dashboard.md) shows what is waiting and what is running.

## Where to find help

A five-step tour runs the first time the app is opened; **Show the tour again** in the
settings menu replays it. **Manual for this page**, in the same menu, opens this manual at
the chapter for the screen you are on. The `?` key, or **Keyboard shortcuts** in the
settings menu, lists the keys that work there. The menu ends with the version, a link to
what changed in it, and the source on GitHub.
