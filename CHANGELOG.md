# Changelog

One line per change, newest first. Written by hand when a release is cut — see CLAUDE.md.

## Unreleased

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
