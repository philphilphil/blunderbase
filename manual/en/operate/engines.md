# Engines

Analysis needs an engine. Engines are rows in the database, not configuration files: you
give one a path, Blunderbase starts the binary, reads the options it declares, and keeps
the row. Nothing is read from a file at start-up and nothing needs a restart.

The Docker image ships **Stockfish** at `/usr/games/stockfish`; `stockfish` on `PATH`
reaches the same binary, and either spelling works in the path field. **Maia** is a separate
download in every case.

## The Engines page

**Compute → Engines** is what is installed, in two parts from top to bottom.

*What runs what*: one row each for Quick, Deep and Human moves, naming the engine assigned
to it and, when it cannot run, saying why in words.

**Engines**: every configured engine — its kind, the machine it runs on, its `Threads`
and `Hash`, which jobs it holds, and whether it is on. A row opens the engine's card.
`Threads` and `Hash` are on the row because they are what one *process* of the engine
costs; how many processes a machine runs at once is not decided here but on
[Machines](runners.md), the page beside this one.

## Adding an engine

**Add an engine**, top right on the Engines page, asks for three things. A path-based
engine is always this server's: a [remote runner](runners.md)'s engines come from its own
yaml, and the engine in your browser is a one-press install on Machines.

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

How many engine processes a machine runs at once is a fact about the machine, and it lives
on [Machines](runners.md#how-much-at-once): this server's **Queue processes** and **Search
slots**, each remote runner's slots, and a budget line that adds them up against the cores
at the `Threads` every row here asks for. This page only sets what one process costs.

## An engine for correspondence

A correspondence search is not a queue job: it is one engine sitting on one position for
hours or days, and it is counted separately. **Search slots** on this server's card under
[Machines](runners.md#how-much-at-once) says how many of those may run at once here — two
by default — and they are slots of their own, so a search never takes the one an imported
game's quick pass is waiting for. Give correspondence **its own engine row** rather than
the one your passes use: a row with `Threads` set high and `Hash` set to as much memory as
you can spare, and pick it in **Search with…** on the position. Editing the options of an
engine starts a fresh process, so the two rows never fight over one.

A search slot is not the same unit as **Queue processes** beside it, and the two are added
rather than shared: that cap is the engine processes the *queue* runs across all tiers,
**Search slots** caps the searches beside them. Two slots and six queue processes are up to
eight engine processes on this machine at once, so set `Threads` on the correspondence row
against what the queue is already using — the budget line on the server's card does the
sum and says when the machine would thrash.

Two things about memory are worth knowing before you set `Hash` to something large. A
**paused** search keeps its process, hash and all, so that resuming it costs seconds
instead of hours — the correspondence page's capacity strip says how many are parked and
what each is holding, and stopping one is what gives that memory back. And **a restart
loses every hash**: the searches come back, the evaluations in the tree come back, but each
engine starts again from the depth its last checkpoint recorded. Nothing about the tree is
lost either way; the whole of it is
[Correspondence](../guide/correspondence.md#pause-stop-and-what-survives).

A GPU engine is counted the same way and shares differently. Two Leela searches at once are
two `lc0` processes on one card, sharing its memory and its time, so each is slower than one
would be and a card that holds one network comfortably may not hold two. Nothing stops you —
a local engine carries no limit on how many copies of it run — but the setup two slots are
meant for is one CPU engine and one GPU engine, each on its own hardware.

**Tasks are the other half of the mode, and they are ordinary queue work.** A task — a
bounded look at one position, and what an
[expansion](../guide/correspondence.md#tasks-and-expansion) is made of — is an
`AnalysisRun` like any other: it takes no search slot, it counts against **Queue
processes** along with the quick and deep passes, and it runs on whichever host the queue
hands it to, [remote runners](runners.md) included. So the engine
picked for a task — in **Queue task…**, **Expand…** or **Refresh subtree…** — may live on a
runner, and where you have a runner that is where it belongs: the tasks go to the other
machine and this one keeps its cores for the searches and for the passes. Tasks sit between the tiers in the queue, ahead of the quick pass every import gets
and behind a deep pass somebody is waiting on, and among themselves the game with the
nearest deadline is worked first. **Clear the queue** on the Analysis page drops the tasks
still waiting along with everything else waiting, and each of their nodes says so.

The ideal is a machine of its own, and a [remote runner](runners.md) is how you get one:
tasks are queued to it like any run, and a search set on one of its engines runs over there
too, holding one of the runner's slots. Only a runner connected over polling, or a browser
tab, takes no search — its link carries queue work and nothing else — and the picker says
so. Give the runner the same care a local correspondence engine gets: a row in its
`runner.yaml` with `Threads` and `Hash` sized for one long search, and slots sized with
the searches counted in.

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
installation. See [Machines](runners.md).
