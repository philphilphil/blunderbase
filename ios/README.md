# Blunderbase Companion (iOS)

A native iPhone app that reads a **hosted Blunderbase instance**. It is the Companion
described in [`docs/distribution.md`](../docs/distribution.md): it uses one reachable
Installation, may cache, and does not contain a second implementation of Blunderbase's
chess and query rules. Every evaluation, classification, Maia distribution and book number
on screen came from the server.

This is a proof of concept. It has two screens that matter — the games list and the game
detail — plus a notes list and settings.

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

## The game screen

The board and the panels share one column and trade space. The players strip, the board and
the transport are on top; Moves, Eval, Engine and Notes are tabs directly underneath. Dragging the grabber between them makes the panels taller and the board smaller,
and the chevron toggles between the resting split and a tall one. At rest the board is as
wide as the phone and the panels get whatever is left, which is why a short phone shows a
full-size board and one row of moves rather than a shrunken board and a long list.

Three ways to move through the game: drag across the board to walk it, tap a move in the
Moves tab, tap or drag the graph in the Eval tab.

## What it talks to

Only the existing REST API and the events socket — no backend change was needed.

| Screen | Endpoint |
|---|---|
| Connect | `GET /api/auth/status`, `POST /api/auth/login`, `POST /api/auth/logout` |
| Games | `GET /api/games?cards=true&…` |
| Game | `GET /api/games/{id}` |
| Notes | `GET /api/notes`, `POST /api/notes` |
| Live engine | `POST/PATCH/DELETE /api/streams`, output on `ws(s)://…/events` |

The API sends moves as SAN and UCI with no position per ply, so the app replays the moves
from the starting position to draw a board. That replay is the only chess logic on the
phone; it decides where the pieces are, never what a move is worth.

## Live analysis

The Engine tab has a switch that opens an analysis board on the **server**, the same
mechanism the web app's infinite analysis uses. Nothing is computed on the phone.

That choice was deliberate. Bundling Stockfish would have made the app 60 MB larger and,
because Stockfish is GPL v3 and this project is MIT, would have changed the licence of the
shipped app. Asking the server instead costs a network round trip and buys three things: the
live numbers come from the same engine as the stored analysis and therefore agree with it,
the licence stays put, and — the useful one — **the engine does not have to be on the server
either.**

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

The book pane, analysis lines and variations on the board, PGN copy (there is no per-game
PGN endpoint), and any offline cache. Live analysis cannot yet be pointed at
a specific engine from the phone: it takes whichever engine holds the deep-tier role, which
is also the one that may live on a runner. There is also no per-device revocable token: the app authenticates with
the owner password like a browser does, because `AuthGuard` accepts only the session cookie
on the REST API today.
