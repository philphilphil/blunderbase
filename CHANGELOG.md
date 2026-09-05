# Changelog

One line per change, newest first. Written by hand when a release is cut — see CLAUDE.md.

## Unreleased

## v0.13.0 — 2026-09-05

- Added a manual in English and German, served in the app and on the site
- Added a queue of live positions the assistant can push, with next and previous
- Added a game replay board to the live position view
- Added a per-account switch to leave a source out of automatic sync
- Changed the demo to refuse whole-library downloads
- Changed the release installers to carry their version in the file name
- Fixed the desktop app packaging its opening data
- Fixed an import interrupted by a restart never finishing

## v0.12.0 — 2026-09-05

- Added an iOS companion app for the games list and game screen
- Added German throughout the app and the landing page
- Added browser Stockfish setup when no engine is assigned
- Added a guided tour of what a new installation has to set up
- Added a worst moments panel for the last thirty days
- Added keyboard shortcuts throughout, and a ? sheet listing them
- Added an opening book pane to the iOS game screen
- Added a light theme to the iOS app
- Changed the demo to analyse in your browser, not on its server
- Changed the licence to AGPL-3.0-or-later
- Changed the analysis board to keep the run's line
- Changed the game's book to open in the explorer
- Changed the Maia column to name the human move
- Changed the line-preview cycler to read as a setting
- Changed the capture and check sounds
- Fixed the phone evicting the browser's analysis board
- Fixed a locked database losing a Lichess or FICS game
- Fixed guessing at /mcp locking the owner out
- Fixed owner setup and event sessions being guessable
- Fixed Windows engine arguments being dropped
- Fixed learning your colour not refolding the stored game card
- Fixed a Maia fill counting as a game's analysis run
- Fixed the analysis board hanging on a finished game
- Fixed a zero blunder tally losing its colour
- Fixed the macOS app not finding a Homebrew engine
- Fixed the iOS book and analysis drifting from the board

## v0.11.0 — 2026-09-03

- Added a public demo mode for serving a read-only library
- Added syncing connected accounts on a schedule
- Added stopping a running import
- Added asking whether an imported PGN holds your own games
- Added a sound as each move lands
- Added an arrow for the move the game played
- Added the move and game a note was written on
- Added remembering which engine the analysis board was pointed at
- Added building the macOS and Windows desktop apps in one command
- Added a time-control filter to the Stats page
- Changed the Stats filters to sit on the page rather than the titlebar
- Changed the notes screen to a time-ordered stream or sheet
- Changed model games to open in the full game screen
- Changed Hints to one switch, with the board settings in a dialog
- Changed the eval graph to bars, with blunder marks
- Changed the sources screen to a box per source
- Changed the board controls into three groups, transport on the right
- Fixed the Stats games tile labelling every game in the window as analysed
- Fixed a reconnecting runner being left with its engines switched off
- Fixed the game notes composer saving the same note twice
- Fixed workers waiting out the full shutdown grace while idle

## v0.10.0 — 2026-09-02

- Added masters and Lichess reference books to the explorer (needs a Lichess API token in Settings)
- Added putting a model game from the explorer into the library
- Added a Mine / Others / All switch to the library
- Added FICS imports
- Added deleting games, one at a time or a whole selection
- Added syncing an account from the beginning
- Added paging to the library
- Added exporting the whole library as annotated PGN
- Added verified backups and restore under Library → Manage
- Added managing engines from the command line
- Changed the look of the app to a quieter desktop style
- Changed the library grid to name both players
- Changed games that arrive without an opening to be named from the book
- Fixed the game screen clipping notes on tall, narrow windows

## v0.9.0 — 2026-08-31

- Added a desktop app with native integrations
- Changed the game screen to a bigger board with one column beside it
- Added the opening book beside the board, per position
- Added per-move clock times to the move list
- Changed the opening explorer to read from a precomputed book
- Changed the Stats page to load from a single read
- Fixed backfill estimates stopping partway through
- Fixed the analysis queue miscounting running against waiting

## v0.8.3 — 2026-08-30

- Fixed heavy dashboard traffic starving the server during backfills
- Changed the player profile to read only what it counts

## v0.8.2 — 2026-08-30

- Fixed the app locking up during large analysis backfills
- Changed stats to read precomputed per-game summaries

## v0.8.1 — 2026-08-30

- Fixed large analysis batches exhausting database connections

## v0.8.0 — 2026-08-29

- Added a command that builds an anonymous demo database
- Added screenshots to the README
- Changed backfills to queue like any other analysis

## v0.7.0 — 2026-08-29

- Added pausing and resuming the analysis queue
- Added player mistake counts and ACPL to game analysis
- Added filtering games by any completed analysis
- Changed eval graphs to focus on your mistakes
- Fixed plain time controls displaying seconds instead of minutes
- Fixed live analysis headers overflowing narrow screens
- Fixed the spelling of multiple inaccuracies

## v0.6.0 — 2026-08-29

- Added a phone layout with a tabbed game view
- Added a Quick analysis button on the game page
- Added an instances cap for runner engines
- Added the MIT license
- Changed analysis to skip Maia levels a game already has

## v0.5.0 — 2026-08-29

- Added an Analysis page with coverage, failed runs and a costed backfill
- Added running Stockfish in this browser tab as a runner
- Added engine roles for Quick, Deep and Human moves
- Added switches for whether quick and deep passes run Maia
- Changed Engines to show the roles, your engines and every machine
- Changed the sidebar to unfold each section's own pages
- Changed Import to one table with a row per source
- Changed errors without their own panel to appear as toasts
- Fixed the analysis board offering engines whose host never streams
- Fixed a game reporting no Maia levels, so fills redid finished work
- Removed the Settings page; each part moved to where it is used

## v0.4.0 — 2026-08-28

- Added engine line previews on hover, with a Board settings card
- Added drawing your own arrows and circles with right-click
- Added per-client MCP keys, minted on Settings → MCP
- Changed the eval bar to fill from your own side
- Changed the eval graph to fill by side, with an "only mine" filter
- Fixed the eval bar ignoring the live analysis
- Fixed a wheel step over the board losing an unsaved note
- Fixed the engine picker offering engines that cannot stream
- Fixed the Maia level label truncating
- Fixed a note not saving when the composer loses focus

## v0.3.1 — 2026-08-28

- Fixed Maia fills being reported as quick passes
- Fixed a game's colour dot showing the wrong side

## v0.3.0 — 2026-08-28

- Added notes on moves, positions and variations, with a Notes page and export
- Added saving variations with a game
- Added support for multiple Maia ratings, with a compare view
- Added filling in missing Maia levels for analysed games
- Added a clear button for the analysis queue
- Added "Save this moment" on the live board
- Removed the folded opening in the move list

## v0.2.1 — 2026-08-27

- Fixed the server drowning during big remote batches (game cards are now stored; run `blunderbase db rebuild-cards` once after upgrading)
- Fixed the queue widget refreshing several times a second

## v0.2.0 — 2026-08-27

- Fixed the server melting down when many analyses run at once
- Fixed remote wss runners failing on TLS and retrying refusals forever
- Added queueing a selection of games in one request
- Added a draggable splitter and a wider board on the game screen
- Added a Maia human/engine dual panel and deep analysis from the transport row
- Added engine lines that walk as variations and survive the session
- Added ⌘K search, a slimmer top bar and a reworked dashboard
- Added a settings page for analysis budgets, thresholds, default rating and Maia elo
- Added deleting all games from settings
- Changed the engines page to a column, with UCI options behind expert mode
- Removed the move-number axis from the eval graph
- Removed PostgreSQL support; SQLite only
