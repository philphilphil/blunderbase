# Blunderbase

Blunderbase is a personal chess database. It imports your games from
Lichess, Chess.com, FICS and PGN files, runs Stockfish over every one as it arrives, and
optionally asks Maia what a human of your rating would have played instead. Everything
lives in one SQLite file that you own: your games, the analysis, your notes, your saved
lines and your statistics.

The same library is readable three ways. The web app is the board, the games list, the
explorer and the statistics. Blunderbase includes no AI of its own, but it serves MCP, so
the assistant you already use in your editor or chat client can read the identical data and
answer from your games rather than from generalities. And
the whole thing is one process on one port, which is why a deployment is a single
container, a single desktop application, or a single command.

## Guide

For everyday use.

One chapter per entry in the app's sidebar, in the sidebar's order.

- [Getting started](guide/getting-started.md) — the first hour: connect an account, import,
  analyse.
- [Dashboard](guide/dashboard.md) — ratings, worst recent moments, recent games, the
  analysis queue, the trends.
- [Games](guide/games.md) — the filter bar, saved cuts, sorting and paging, acting on
  several games, deleting.
- [Analysing a game](guide/game.md) — the board, the evaluation graph, engine lines,
  variations and move classifications.
- [Explorer and repertoire](guide/explorer.md) — your own opening tree, the Lichess
  reference databases and the repertoire.
- [Statistics](guide/stats.md) — what the numbers count and how to slice them.
- [Notes](guide/notes.md) — notes on positions, games and variations.
- [Live](guide/live.md) — the board an MCP client drives, and saving a moment off it.
- [Library](guide/library.md) — importing from Lichess, Chess.com, FICS and PGN, syncing on
  a clock, exporting, backing up, resetting.
- [Analysis](guide/analysis.md) — coverage, quick and deep passes, Maia levels, what counts
  as a blunder.
- Engines is the next entry in the sidebar; it is written up under Operate, in
  [Engines](operate/engines.md).
- [Your AI assistant](guide/coach.md) — connecting an MCP client and what it can ask.
- [Settings](guide/settings.md) — language, theme, board preferences, shortcuts, the tour.

## Operate

For whoever runs the installation.

- [Install](operate/install.md) — Docker, the desktop applications, first run, signing in.
- [Deploy](operate/deploy.md) — reverse proxy and TLS, the public URL, read-only mode.
- [Engines](operate/engines.md) — Stockfish and Maia, the three roles, capacity.
- [Remote runners](operate/runners.md) — running engines on another machine.
- [Configuration](operate/configuration.md) — every environment variable.
- [Command line](operate/cli.md) — every command and flag.
- [Backup and restore](operate/backup.md) — PGN export, database backups, restoring.

Blunderbase is free software under the AGPL-3.0-or-later. The source, the sample compose
files and the issue tracker are at
[github.com/philphilphil/blunderbase](https://github.com/philphilphil/blunderbase).
