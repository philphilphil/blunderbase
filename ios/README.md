# Blunderbase Companion (iOS)

A native iPhone app that reads a **hosted Blunderbase instance**. It is the Companion
described in [`docs/distribution.md`](../docs/distribution.md): it uses one reachable
Installation, may cache, and does not contain a second implementation of Blunderbase's
chess and query rules. Every evaluation, classification, Maia distribution and book number
on screen came from the server.

This is a proof of concept. Five tabs, in the web rail's order: a dashboard, the games list,
the explorer, a notes list and settings — and the game screen, which every one of them
leads into.

## Requirements

- Xcode 26 or newer, iOS 17 deployment target
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`)
- A reachable Blunderbase instance over HTTPS, and its password

## Build

The `.xcodeproj` is generated and not checked in.

```bash
cd ios
xcodegen generate
open Blunderbase.xcodeproj
```

Or from the command line:

```bash
xcodebuild -scheme Blunderbase -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
xcodebuild -scheme Blunderbase -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

On first launch the app asks for the server URL and the password. It signs in with
`POST /api/auth/login` and keeps the `blunderbase_session` cookie, which the server slides
forward for thirty days, so the app stays signed in between launches.

Under the address field is **Try the demo**, which connects to `demo.blunderbase.org` — the
public read-only library of anonymised games, which has no password, so one tap signs in.
It is there for anyone deciding whether to host a Blunderbase, and it is what the App Store
reviewer uses: the review notes point at that button rather than handing over credentials.
Signing out of the demo offers to reconnect rather than asking for a password it does not
have; **Use a different server** is the way back to your own.

## The dashboard

The web dashboard's sections in the web's order, minus the two that act on the server: the
line under the title counts the games and the blunders; **Ratings** draws one chart per
speed with a line per platform, a year back by default, cut by the window control at the
newest rated game, with a legend for the sites and a speeds menu that switches charts off
and remembers it on this phone; **Worst
moments** is the six worst moves of the last thirty days, in words rather than boards
because a board that size is not legible on a phone, each opening its game on the position
the blunder was played from; **Last N days** is blunders per game, the win percentage given
away and the score, each against the equally long window before. The sync button and the
analysis queue stay in the browser, where a tap can do something about them, and the recent
games are the Games tab.

## The games list

A table with filters and nothing above it: result, blunders, analysed, speed and source as
chips under the search field, and two lines per game — names and result, then date, time
control, length, the worst drop and the flag chips, with the eval curve as a stamp.

## The explorer

Your own openings: a board, and under it what your games did from the position on it — how
often you have been here, the split, the score and the average drop of every continuation
you have played. Tapping a row plays it and the table becomes that position's; tapping the
board plays any move, book or not. **Games in this line** lists the games that reached the
position, each opening on that very move, and the segmented control narrows the fold to
the games you had one colour in. The Lichess masters and rated pools the web's explorer
also reads stay in the browser: a phone has room for one table under a board, and the one
worth carrying is your own.

## The game screen

The board and the panels share one column and trade space. The players strip, the board and
the transport are on top; Moves, Eval, Engine, Book and Notes are tabs directly underneath.
Book is the owner's own history of the position on the board — how often they have been
here, how it went, and what they played from here — and it is the same fold over the same
table the explorer page reads, so the two agree. Tapping a continuation plays it and the
book of the position it led to takes its place, so a line can be clicked through row by
row; the game's own plies ship with the game, and a position off the game line is asked for
one at a time from `/explorer/book`. Dragging the grabber between them makes the panels taller and the board smaller,
and the chevron toggles between the resting split and a tall one. At rest the board is as
wide as the phone and the panels get whatever is left, which is why a short phone shows a
full-size board and one row of moves rather than a shrunken board and a long list.

Three ways to move through the game: drag across the board to walk it, tap a move in the
Moves tab, tap or drag the graph in the Eval tab.

## Reading without the engine

The web app's ⇧E is here too: the computer in the games list's bar, **Hide the engine** in
the game's menu, or the switch under Settings › Engine. On, it hides everything an engine
has said about your games so you can annotate a game yourself first and check afterwards:
the list loses the stamps, the drops and the `??` chips and the worst-moments strip; the game
loses the eval bar, the glyph on the board, the advice arrows, the Eval and Engine tabs and
the live board; the Book keeps its counts and scores but not its average drop. What stays is
the game and what Blunderbase has *done* — the `deep` and `unanalysed` markers on the rows.
It is a setting of this phone, it survives relaunches, and the games list's computer goes
dim while it is on so a clean move list is not mistaken for an unanalysed game.

## Languages

English and German, following the phone: iOS picks the app's language from the system
language list, and Settings › Blunderbase › Language overrides it for this app alone. There
is no language switch inside the app, because the phone already has one.

Every string lives in `Blunderbase/Resources/Localizable.xcstrings`, a String Catalog with
English as the source. SwiftUI literals (`Text("…")`, `Button("…")`, `Label`) are keys by
themselves; a string that is built as a plain `String` — an accessibility label, a chip
title, an error sentence, a helper that takes `String` — goes through `String(localized:)`
so it is a key too. `SWIFT_EMIT_LOC_STRINGS` is on, so building in Xcode adds a new key to
the catalog on its own; a German value is then written by hand, in German rather than as
translated English, using the words the manual uses (grober Patzer, Bedenkzeit, Remis,
Quelle). Numbers that are identifiers — a rating, an Elo, a ply — are written with
`Text(verbatim:)` so they are never grouped into `1.712`; dates go through `Format.date`,
which takes its order and punctuation from the locale.

## What it talks to

Only the existing REST API and the events socket — no backend change was needed.

| Screen | Endpoint |
|---|---|
| Connect | `GET /api/auth/status`, `POST /api/auth/login`, `POST /api/auth/logout` |
| Dashboard | `GET /api/stats/profile`, `GET /api/stats/dashboard`, `GET /api/stats/compare`, `GET /api/stats/worst-moments` |
| Games | `GET /api/games?cards=true&…` |
| Explorer | `GET /api/explorer/book`, `GET /api/explorer/positions` |
| Game | `GET /api/games/{id}`, `GET /api/explorer/book` |
| Notes | `GET /api/notes`, `POST /api/notes` |
| Live engine | `POST/PATCH/DELETE /api/streams`, output on `ws(s)://…/events` |

The API sends moves as SAN and UCI with no position per ply, so the app replays the moves
from the starting position to draw a board. That replay is the only chess logic on the
phone; it decides where the pieces are, never what a move is worth.

## Live analysis

The Engine tab has a switch that opens an analysis board on the **server**, the same
mechanism the web app's infinite analysis uses. Nothing is computed on the phone.

That choice was deliberate. Bundling Stockfish would have made the app 60 MB larger and
put a GPL binary through App Store review, which has a history of rejecting GPL software
over the store terms. Asking the server instead costs a network round trip and buys three
things: the live numbers come from the same engine as the stored analysis and therefore
agree with it, the app ships nothing but its own code, and — the useful one — **the engine
does not have to be on the server either.**

If the always-on instance has a desktop connected as a runner, a live board can be served by
that desktop's engine. The stream broker resolves the engine, sees it belongs to a runner and
dispatches over the runner link; the frames come back byte-identical, so a remote board and a
local one are the same thing to the phone. The panel names the machine that answered. That
needs the instance in `server` runtime mode, the runner connected over websocket rather than
polling, and the engine advertising `streams: true`, which is the default for a UCI engine.

A stream belongs to a `surface`, and opening a second board on the same surface evicts the
first. The phone has its own — `companion`, beside the browser's `game` and `live` — so
turning live analysis on here leaves a browser sitting on the same game alone, and the
server holds three boards at once rather than two.

## Dependencies

None. The app is SwiftUI, Swift Charts and `URLSession`.

[chesskit-swift](https://github.com/chesskit-app/chesskit-swift) was the intended move-replay
dependency and was dropped after testing it: version 0.17.0 applies moves correctly but
writes three wrong FENs — the en-passant target survives the capture that consumes it, the
halfmove clock is not reset by an en-passant capture, and taking a rook on its home square
does not clear the opponent's castling right. Those FENs would go to an engine, so
`Chess/Replay.swift` applies moves itself. It is an applier and not an engine: the server
already validated every move it is given, so it checks that a move is coherent and stops the
replay when it is not, rather than generating moves to re-validate them.

The board uses the **cburnett** piece set by Colin M. L. Burnett, the same set the web app
uses, licensed **CC BY-SA 3.0**. The SVGs are extracted from the `chessground` package in
`web/node_modules` into the asset catalog by `scripts/extract-pieces.swift`; the generated
imagesets are checked in so the app builds without `node_modules`.

## Not in the proof of concept

Analysis lines and variations on the board, PGN copy (there is no per-game
PGN endpoint), and any offline cache. Live analysis cannot yet be pointed at
a specific engine from the phone: it takes whichever engine holds the deep-tier role, which
is also the one that may live on a runner. There is also no per-device revocable token: the app authenticates with
the owner password like a browser does, because `AuthGuard` accepts only the session cookie
on the REST API today.
