# Changelog

One line per change, newest first. Written by hand when a release is cut — see CLAUDE.md.

## Unreleased

## v0.2.0 — 2026-08-27

- fixed the server melting down when many analyses run at once (runner write storm, UI refetch storm, uncompressed transfers holding connections, stats re-scanned every few seconds)
- queueing a selection of games is one request now — the queue fills at once instead of climbing
- reworked the game screen: the board takes the spare width, a draggable splitter sizes the moves column, the engine/Maia box keeps one place and height
- eval graph drops its move-number axis
- engines page narrows to a column; UCI options and test runs move behind expert mode
- delete all games from settings, behind the owner's password
- fixed remote wss runners: TLS dial and refusals that retried forever
- SQLite only — the PostgreSQL escape hatch retires
- ⌘K search everywhere, slimmer top bar, reworked dashboard
- settings page: analysis budgets, classification thresholds, default rating, Maia target elo
- game screen: clicked engine lines walk as variations and survive the session, Maia human/engine dual panel, deep analysis from the transport row
