# Engines

Analysis needs an engine. Engines are rows in the database, not configuration files: you
give one a path, Blunderbase starts the binary, reads the options it declares, and keeps
the row. Nothing is read from a file at start-up and nothing needs a restart.

The Docker image ships **Stockfish** at `/usr/games/stockfish`; `stockfish` on `PATH`
reaches the same binary, and either spelling works in the path field. **Maia** is a separate
download in every case.

## The Engines page

One page, in three parts from top to bottom.

*What runs what*: one row each for Quick, Deep and Human moves, naming the engine assigned
to it and, when it cannot run, saying why in words.

**Engine inventory**: every configured engine, what it does and where it runs. A row opens
the engine's card.

**Compute capacity**: this server, this browser, and every [remote runner](runners.md),
each with the engines it advertises and its slots. Adding an engine, installing browser
Stockfish and registering a runner all happen here.

## Adding an engine

Under **Compute capacity**, open **Add an engine** on this server's card and fill in three
things.

| Field | What goes in it |
|---|---|
| Name | Yours to choose. Unique, and how the engine is named everywhere else |
| Path | A file, a full command line with arguments, or a name on `PATH` |
| Kind | `uci` for a search engine, `maia` for a human-move model |

Blunderbase probes the binary before it saves the row, so a wrong path or an option the
engine does not declare is refused now rather than at analysis time. UCI options are edited
on the engine's card, under **More settings**, and validated against what the binary
declared.

The first engine of a kind to be registered takes the roles it fits, so a fresh
installation works without a visit to the roles form. It never takes a role that is already
assigned.

## The three roles

| Role | What it runs |
|---|---|
| Quick | The fast pass every imported game gets |
| Deep | The slower, multi-line pass you ask for |
| Human moves | Maia — what a player of your rating would have played |

Assign them at the top of the Engines page. **Nothing falls back.** If the engine holding a role is
switched off, deleted, or on a machine that is not connected, that role does not run and
the app says which engine and why. No other engine quietly takes over.

An installation with no Maia degrades rather than fails: you lose the human-move
predictions, not the evaluation.

What each role costs and when it runs is [Analysis](../guide/analysis.md).

## Testing an engine

On an engine's card, open **More settings**.

- **Probe** re-reads the binary's declared options. Use it after the engine is upgraded.
- **Test run** searches one position with this engine and shows what came back. Set the
  **Position**, **Nodes** and **Lines**; a Maia engine offers **Ratings** instead.

An engine a runner advertises is read-only here, and its test run is refused rather than
starting whatever *this* host has at that path. Its truth is the runner's own configuration
file.

## Capacity

**Compute capacity**, at the bottom of the Engines page, shows every host that can take
engine work: this server, this browser if you have installed it as a runner, and each remote
runner with the number of slots it advertises. A slot is one engine job or one analysis
board.

On the server itself, `BLUNDERBASE_ANALYSIS_CONCURRENCY` caps how many engine processes run
at once across all tiers. It defaults to the machine's cores minus two.
`BLUNDERBASE_ANALYSIS_WORKERS` turns the in-process workers off entirely, for an
installation that drains the queue from `blunderbase analyze` on its own schedule. See
[Configuration](configuration.md).

## The engine in your browser

When Quick, Deep or continuous analysis is refused because a role has no engine, the game
screen offers **Set up browser engine**. It installs this browser as a runner, waits for
its Stockfish to register, gives it the role if that role is still empty, and then runs the
pass you asked for. It never leaves the board.

A browser engine wants cross-origin isolation to run multi-threaded. Behind a proxy, that
is [`BLUNDERBASE_CROSS_ORIGIN_ISOLATION`](deploy.md#settings-worth-knowing).

## Maia

Maia is an lc0-style human-move model: it answers with what a player of a given rating
would actually play, not with what is best. It is deliberately not bundled, because it is a
Python package plus weights that are downloaded rather than packaged.

To use it:

1. Install a Maia build on the machine that will run it. In a container, mount it in.
2. Register it with **Kind** `maia` and, in the path field, the whole command line —
   including the weights directory, so it reads its cache and never goes to the network:

   ```
   /engines/maia3/bin/maia3-5m --use-uci-history --cache-dir /engines/maia3/models --local-files-only
   ```

3. Give it the **Human moves** role.

The rating Maia is asked at is a single application setting, **Analysis → Maia**, not a
per-engine one, so nothing ever asks about two different players. It is clamped to
1100–2000, and an engine that declares its own bounds narrows that further.

A Maia never drives the analysis board — it produces a move policy, not a search.

## From the command line

The same thing without a browser, for a headless machine or a script.

```console
$ blunderbase engines add sf-local stockfish --option Threads=4 --role quick --role deep
engine 'sf-local' Stockfish 18 registered: uci at stockfish
serves the quick tier, the deep tier
$ blunderbase engines list
$ blunderbase engines remove sf-local
```

`add` probes the binary exactly as the page does. `--replace` updates the engine of that
name instead of refusing, which makes the command safe to re-run and is how you follow a
binary that moved. `--role` takes a role from whatever holds it; without it, only unassigned
roles are filled. An engine a runner advertises cannot be changed here.

Every flag is in [Command line](cli.md#engines).

## Engines on another machine

A machine with cores to spare can run engines for this installation without being a second
installation. See [Remote runners](runners.md).
