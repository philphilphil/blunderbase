# Changelog

One line per change, newest first. Written by hand when a release is cut — see CLAUDE.md.

## Unreleased

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
