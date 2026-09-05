# Reference

The details that used to live in the README: authentication, the tour, engines,
configuration, the CLI, releases and testing. Deployment is in [deploy.md](deploy.md), remote runners
in [runners.md](runners.md), the system design in [ARCHITECTURE.md](ARCHITECTURE.md).

## Signing in

One user, one password, no registration. **The first person to open a fresh deployment
chooses the password** — until then every API call answers `401 {"error":
"setup_required"}` and the UI shows the setup screen instead of the login one. After
that, signing in sets an HTTP-only `blunderbase_session` cookie that slides over 30 days,
and every route is behind it except `/health`, `/auth/*`, `/mcp` (which has its own bearer
guard) and the web app's own files — the page has to load in order to show a login form.
Five wrong passwords in a row close the door for a few seconds, doubling to five minutes.

**The MCP bearer token is that same password, or a key you mint for the client.** Nothing
extra to configure: set up the deployment in the browser and the coach connects with what
you already typed. Once more than one client wants in, mint a key per client on
**Assistant**: `bb_mcp_…`, stored as a SHA-256, shown exactly once, and revocable on
its own — deleting a key signs out that one client instead of every browser and the other
coaches. The list shows when each key was last used, so a forgotten one is easy to spot.

`/mcp` accepts, in this order: `BLUNDERBASE_MCP_BEARER_KEY` when set (an extra accepted
token, not a replacement — it is how automation and the compose files keep working while
everything else changes), then a stored key, then the password. `/mcp` is always mounted
and answers 401 to everyone until one of the three exists — so a password chosen in the
browser reaches the coach immediately, with no restart. Only the password is rate limited
there, and on a budget of `/mcp`'s own — ten wrong passwords a minute, and then no
password is checked at all until that minute has rolled past. Guessing at `/mcp` therefore
never costs the browser login its lockout, and a minted key is never slowed down by
somebody else's guesses.

```bash
uv run blunderbase set-password    # bootstrap or reset headless; asked twice, never echoed
```

Only the hash is ever stored — `hashlib.scrypt` over a per-credential random salt, with
the cost parameters kept beside it so they can be raised later. Session tokens are stored
hashed too, so a copy of the database is not a way in. A password change signs every other
browser out.

**The demo has no door.** `BLUNDERBASE_RUNTIME_MODE=demo` lets everyone in as the owner
and lets nobody change anything: the guard answers every request, and a second middleware
(`api/readonly.py`) refuses everything but `GET`, `HEAD` and `OPTIONS` with `403
{"error": "read_only"}` before a handler sees it. The exceptions are the three "reads
spelled as POSTs" that touch no row — the analysis board (`/streams`), Maia's answer for a
position and a one-off engine eval — so the game view stays alive. `/mcp` is not mounted
at all. The runner transport is: a runner dials in with a token only the owner minted
(`demo create --runners` carries the hashes over) and minting one is a write the demo
refuses, which is what lets the owner's remote engine sit behind the demo's analysis
board without handing a visitor anything. The page shows a *Demo · read-only* chip in the titlebar
and one toast the first time a write is refused. Run it only on a database `demo create`
built; see "A public demo" in [deploy.md](deploy.md#a-public-demo).

## The tour

Nothing else in the app explains itself, so a fresh installation runs a five-step guided
tour the first time it is opened: the import screen games come from, the engines that have to be
registered before anything is analysed, the board settings behind the gear under the board,
what a note is pinned to, and the MCP door onto the same database. It explains no chess and
names no screen the reader can already see — only what they could not have found by
clicking. Each step is a small card pointing at the real control, with **Back**, **Next** and a
**Skip** that ends it; Escape does the same.

It runs once. Whether it has been seen is a row on the deployment (`GET`/`PUT
/settings/tour`, `{"seen": true}`) rather than something in the browser, so a second machine
or a cleared cache does not bring it back — and **Show the tour again** in the account menu
is how to get it back on purpose. The public demo has no owner and refuses every write, so
there it starts for each visitor and remembers the answer in that browser's
`localStorage` instead.

A step whose control is not on screen is skipped rather than left pointing at nothing: an
empty library has no game to open the board settings on, and a deployment serving no MCP has
no assistant page, so neither step is part of the tour that install runs.

## Languages

The web app speaks English and German. The choice is the browser's, not the account's: it
is kept in that browser's `localStorage` (`blunderbase.locale`) beside the theme, so a phone
in German and a desk in English is an ordinary setup, and the login screen is readable
before there is a session to hold a preference. With nothing stored the browser's own
language list decides; anything that is not one of the two falls back to English. The
switch is in the account menu, under **Language**, and takes effect at once — the page
under it remounts, which is why an unsaved note is worth saving first.

Only the web app is translated. The MCP tools, the backend's error text and the CLI stay
English: an assistant reads those, not a person, and a coach that is handed a German tool
description answers worse. The landing page has a German copy at `/de/`
(`site/de/index.html`), written by hand rather than generated.

**How it is built.** [Lingui](https://lingui.dev). The English text in a component *is* the
source string — `<Trans>Nothing to analyse yet</Trans>`, `` t`Save note` `` — and its
message id is derived from it, so there is no key file to keep in step with the code. Four
forms, and which one depends only on where the string sits:

| Where | Use |
|---|---|
| Text in JSX | `<Trans>…</Trans>` from `@lingui/react/macro`; the whole sentence in one, links and `<strong>` inside it |
| A string in a component or hook (`title`, `aria-label`, a toast) | `const { t } = useLingui()` from `@lingui/react/macro`, then `` t`…` `` |
| A label in a module-level table | `` msg`…` `` from `@lingui/core/macro`, typed `MessageDescriptor`, resolved with `i18n._()` where it is rendered |
| A helper with no React in it | the global `t` from `@lingui/core/macro` |

Plurals are `<Plural>` / `plural()`; the same English word with two meanings gets a
`context`. Never build a sentence from translated fragments.

The catalogs are `web/src/locales/{en,de}/messages.po`, checked in. `pnpm i18n` (from
`web/`) re-extracts them from the source after a string is added or changed; the English one
is only a listing, the German one is where translations go, with `msgstr ""` marking what is
still missing. CI runs the extraction and fails when the checked-in catalogs differ from
what the code says, so a new string cannot ship unnoticed. The `.po` files are compiled at
build time by the Vite plugin; nothing generated is committed. Tests activate English with an
empty catalog, so what they read is the source text and no test has to know a language
exists.

**Adding a language.** Add its tag to `locales` in `web/lingui.config.ts` and to `LOCALES`
and `LOCALE_NAMES` in `web/src/lib/i18n/locale.ts` (the name is in the language itself),
run `pnpm i18n`, translate `web/src/locales/<tag>/messages.po`, and add the tag to
`isLocale`. Number and date formatting follows the browser, not the chosen language, so
nothing else changes.

## Engines

Engines are rows, not configuration: on **Engines**, give one a path (a file, a
command line, or a name on `PATH`), and Blunderbase probes the binary, reads the options
it declares and validates what you set against them. The owner assigns one engine to each
of Quick, Deep and Human moves; nothing falls back. If the engine assigned to a role is
switched off, deleted or on a machine that is not connected, that role does not run and
says which engine and why — no other engine quietly takes over.

The page has two tabs. **Engines** opens with "what runs what" — one row each for Quick,
Deep and Human moves, naming the engine assigned to it and, when it cannot run, saying why
in words. Below it is the roster and one engine's whole card. **Machines** (`?tab=machines`,
a link you can be sent to) is the runners, this browser as a runner, and their tokens. An
engine advertises only what kind of thing it is — a UCI engine or a human-move model — and
never claims a role, so a runner's yaml cannot decide what its engines are used for. The
first engine of a kind to be registered does take the roles it fits, which is what makes a
fresh install and a first-time runner work without a visit to the form; it never takes one
that is already assigned.

The image ships **Stockfish** at `/usr/games/stockfish`, and `stockfish` on `PATH` reaches
it — either spelling works in the path field. **Maia** is an lc0 build with its own
weights and is deliberately not bundled: mount it into the container and register the
path. No Maia degrades rather than fails — you lose the human-move predictions, not the
evaluation.

The same thing from a shell, for a machine with no browser open and for scripting a dev
box:

```console
$ blunderbase engines add sf-local stockfish --option Threads=4 --role quick --role deep
engine 'sf-local' Stockfish 18 registered: uci at stockfish
serves the quick tier, the deep tier
$ blunderbase engines list
$ blunderbase engines remove sf-local
```

`add` probes the binary exactly as the page does, so a wrong path or an option the engine
does not declare is refused here rather than at analysis time. `--replace` updates the
engine of that name instead of refusing, which is what makes the command safe to re-run —
it re-probes and rewrites the row, so it is also how you follow a binary that moved.
`--role` takes a role from whatever holds it; without it, only roles nobody has assigned
yet are filled. An engine a *runner* advertises is refused: that row is the other machine's
advertisement and `docs/runners.md`'s yaml is where it changes.

**`make engines`** is that pair of commands for this checkout — Stockfish and Maia,
registered as local engines on the dev database and holding the three roles. It writes
rows, so it is a one-off per checkout rather than something `make run` needs.

```console
$ make engines
```

Neither binary has to be named. Stockfish is whatever `stockfish` reaches on `PATH`. Maia
is looked for at `engines/maia3/bin/maia3-5m` — `engines/` at the repo root is gitignored
and is where a downloaded engine belongs, and those are the container's own paths
(`engines/docker/Dockerfile` builds the same `bin` and `models` under `/engines/maia3`), so
one layout works in both places — then on `PATH`. A Maia somewhere else is named once:

```console
$ make engines MAIA=~/some/where/maia3-5m MAIA_MODELS=~/some/where/models
```

or, so it survives the next invocation, as `MAIA=` and `MAIA_MODELS=` lines in a `.env`
beside the Makefile. That file is gitignored and read only by `make`; the backend's own
settings are `BLUNDERBASE_*` environment variables and never come from it. Found or not,
the run says which — a missing Maia leaves human moves unassigned and prints the two ways
to fix it, rather than failing.

`SF` and `SF_THREADS` (default 4, since the dev server is usually on the same laptop)
override the search engine the same way. `MAIA_MODELS` becomes `--cache-dir …
--local-files-only`, so a machine with the weights cached answers with no network.

Nothing here is a prerequisite the owner has to have satisfied before pressing a button.
When Quick, Deep or the continuous-analysis switch is refused because that role has no
engine assigned, the refusal is not a toast — the game opens a dialog offering **Go to
engine page** and **Set up browser engine**. The second one never leaves the board: it
installs this browser as a runner (reusing one already installed), waits for Stockfish to
register, gives it the role if that role is still empty, and then runs the pass or opens
the board that was asked for in the first place. Any other refusal — an engine that is
switched off, or on a machine that is not connected — is still a toast naming it, because
a browser engine is not what that deployment is missing.

The public demo is the same dialog with a shorter path behind it. It is read-only, so
nothing is registered and nothing is saved: Stockfish starts in the tab, Quick and Deep and
the analysis board all run there, and the results live in that tab until it is reloaded.
The stored Quick pass every demo game already carries needs no engine at all. Its Engines
page is its own screen (`routes/engines/DemoEngines.tsx`): browser Stockfish, then three
lines naming what the real page holds — local engines, remote runners, roles. The real page
shown empty would read as "Blunderbase has no engines" rather than "this demo has none of
its own", which is the one impression it must not leave.

## Opening names

The explorer names a position from a vendored copy of
[lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) — 3,810
openings, **CC0-1.0**, taken at commit `4b86227` (2026-08-04). It lives as
`backend/data/openings.tsv` (`epd`, `eco`, `name`) with the licence text beside it as
`backend/data/openings.COPYING.txt`, and it is read by `backend/adapters/openings.py`.

Upstream ships no EPDs — its `dist/` build is a CI artifact — so the keys are derived here
by replaying each opening's PGN. `uv run python scripts/build_openings.py` regenerates the
table from the pinned commit (`--ref master` for what is current, `--source <dir>` for a
local checkout); bump `UPSTREAM_REF` in the script and the commit above together.

The book is shallow — most openings are named three to five plies in and none past
seventeen — so `/explorer` takes the line it was reached by (`?line=e2e4,e7e5`) and names
the deepest ancestor the book knows, reporting which ply that was. Where the book knows
nothing, the web app falls back to the ECO tags on the owner's own games.

## Configuration

Every setting is an environment variable with a `BLUNDERBASE_` prefix
(`backend/config.py` is the whole list, with defaults and why).

| Variable | Default | |
|---|---|---|
| `BLUNDERBASE_DB_PATH` | `<root>/data/blunderbase.db` | the SQLite file (`/data/blunderbase.db` in the image) |
| `BLUNDERBASE_DATA_DIR` | `<root>/data` | everything written that is not the database |
| `BLUNDERBASE_WEB_DIST` | `<root>/web/dist` | the built web app; a directory that is not there is simply not served |
| `BLUNDERBASE_CROSS_ORIGIN_ISOLATION` | `true` | serve the page with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, which is what a browser wants before it will give a tab a `SharedArrayBuffer` — and without one an engine running in the browser is single-threaded. The cost is that every **cross-origin** subresource must opt in with CORP or be blocked; the build loads none today. Turn it off for a proxy that rewrites the headers, or a page that has to load an asset from somewhere else |
| `BLUNDERBASE_HOST` `BLUNDERBASE_PORT` | `127.0.0.1` `8765` | what `serve` binds |
| `BLUNDERBASE_RUNTIME_MODE` | `server` | `server`, `desktop` (the native shell's, needs `BLUNDERBASE_DESKTOP_TOKEN`) or `demo` — the public, read-only demo: no password, no `/mcp`, runners only with tokens the source library already had, and every write answers `403 read_only`. Only ever for a database `demo create` built |
| `BLUNDERBASE_MCP_BEARER_KEY` | — | one more token `/mcp` accepts, beside the minted keys and the owner's password; for compose files and automation |
| `BLUNDERBASE_ANALYSIS_CONCURRENCY` | cores − 2 | engine processes at once, across every tier |
| `BLUNDERBASE_ANALYSIS_WORKERS` | `true` | off for a deployment that drains the queue from `blunderbase analyze` elsewhere |

The engine budgets, the classification thresholds and everything about the Maia pass are
**not** variables. They are stored in the database, edited under **Analysis → Engine
passes** and **Analysis → Maia** (`GET`/`PUT /api/settings`,
`backend/services/app_settings.py`), and read where they are used, so a change takes
effect on the next thing you click rather than the next restart.
Unset means the default in that table, not a null.

| Setting | Default | |
|---|---|---|
| `maia_target_elo` | `2000` | the single rating every Maia question is asked at — the rating you are playing towards, clamped to 1100–2000. Analysis bakes it into every ply it asks about and the analysis board queries it live, so nothing ever asks about two different humans |
| `maia_on_quick` `maia_on_deep` | `1` `0` | whether a pass of that tier also asks the human-move model. Read when a run is queued, like the budgets. The Maia half is 40-70% of a quick pass, and a deep pass would recompute the policy the quick one already stored, so deep is off — use the fill button to add levels to a game that only ever had a deep pass |
| `maia_both_sides` | `1` | ask Maia about every ply, both colours. `0` asks about your own moves only and halves what the pass costs; you lose "what will a human opposite me fall into", which is a question about the positions your opponent moves in. Read per plan, not at enqueue |
| `quick_nodes` `deep_nodes` `deep_multipv` | `250000` `2000000` `4` | the per-position budget of each tier, and the lines a deep pass keeps. Read when a run is queued, so they size the next run rather than the queue |
| `inaccuracy_threshold` `mistake_threshold` `blunder_threshold` | `5` `10` `15` | win-percentage points lost by the mover — Lichess's own cuts on the same curve. The three have to rise; a set of them that does not is the one change refused rather than clamped |

Everything else out of range is clamped rather than refused, so what a save answers with is
what is in force. Budgets and thresholds apply to runs from then on; a game already
analysed keeps the numbers it was analysed with until a fresh pass runs over it.

## Syncing on a schedule

The Sync button on the import page can be pressed for you: tick **Sync automatically**
under the sources grid and say every how many minutes. From then on every connected
account on Lichess, Chess.com or FICS is read again from its last cursor once that long has
passed since its last sync started — whatever that sync did, so a failing one is retried on
the same clock rather than every tick. One account at a time, in the order the table lists
them, and never while a sync of it is still running. Each run lands in the sync history like
a manual one and shows on `/events` the same way.

It is a stored setting (`GET`/`PUT /import/schedule`, `{"minutes": 30}` or `null`), read at
every tick, so a change takes effect without a restart; `BLUNDERBASE_AUTO_SYNC_POLL_SECONDS`
(default 60) is only how often the clock is looked at. The scheduler runs in the serve
process, off by default and never in the demo; `blunderbase import …` from cron is the same
thing for a deployment that would rather own the clock.

## Stopping an import

A sync or a PGN in flight shows its progress inside the box of the source doing it, with a
**Stop** button beside the counts. It takes effect after the game the run is on: everything already
imported stays, and pressing Sync or uploading the same file again picks up from there,
because every route in deduplicates on the way (a game already in the library is *skipped*,
not stored twice). The sync history records the run as **Stopped** rather than as a
failure. It is worth knowing for a first sync of a long archive or a PGN of tens of
thousands of games — there is no penalty for stopping one half-way.

A stopped run keeps no cursor, so the next one starts where the last *finished* one did and
skips forward through what has already arrived. An import started from the command line is
stopped there, with Ctrl-C.

## Importing a PGN

A sync knows whose games it brought — they are the account's. A file does not, and it is as
likely to be a master collection or a friend's export as it is to be your own archive. So
the PGN row asks: **Mine** or **Not mine**, beside the file it is about. Dropping a PGN
anywhere else in the app asks the same question in a dialog before it imports.

**Not mine** stores the games with `is_owner_game` off, which is what a game added from the
reference explorer already is: analysed, annotated and searchable like any other game, and
counted in no statistic — the games list finds them under **Others**, and the game screen
marks them *not your game*. It is a presumption rather than an override, so a game one of
your accounts is actually playing in is claimed as yours whatever the file was said to be.

On the API it is `mine` — `POST /import/pgn/upload?mine=false`, or `{"mine": false}` on
`POST /import/pgn`; on the CLI it is `blunderbase import pgn game.pgn --not-mine`. Left
out, an import is your own games, which is what every PGN imported before the flag existed
was taken to be.

## The reference explorer and its Lichess token

The Explorer page reads three databases: **your own games**, and two of Lichess's — the
**masters** archive (over-the-board games between titled players) and the **rated lichess**
pools, narrowable by speed and rating band. Looking at the two reference sources stores
nothing: no game is imported, and nothing they say is ever added to the numbers your own
games give. A model game opened from them opens in the **full game view**, the same screen
one of your own games opens in: the board with its analysis line, the move table, the live
engine search and Maia's read of the position all work, because all of them are about the
position rather than about a row in your database. What is missing is what needs a row —
the stored analysis passes, notes, pinned lines — and the way to get those is **Add to
library**, in the row of controls under the board beside **Back to explorer**. That stores
the game as one you did not play: it gets the quick analysis pass like any import, and takes notes, but it counts
in no statistic and is not in your opening tree. The games list shows your own games by
default; the **Mine / Others / All** switch at the front of its filter bar shows the added
games on their own or beside yours. (A note you write while
walking a reference line is still your own note and is kept, because it is about the
position rather than about their game; it counts towards nothing.)

Both reference sources need a **Lichess personal API token**, because `explorer.lichess.ovh`
stopped answering anonymous requests. Mint one at
<https://lichess.org/account/oauth/token> — **no scopes are
needed**, so create it with everything unticked and give it a name you will recognise. Paste
it into Blunderbase where the reference sources ask for it (`GET`/`PUT /api/reference/token`);
it is kept as the `lichess_token` setting row, it is never answered back to the browser, and
an empty box clears it. It is not the same thing as the token an import may use, and saving
the analysis form never touches it.

Without a token the two reference sources refuse rather than come back empty
(`lichess_token_missing`), and a token Lichess no longer accepts says so as well
(`lichess_token_rejected`) — paste a fresh one. A masters model game is served by the same
host and needs the token too; a lichess model game comes from the public game export and
does not. Everything else on the Explorer page, and every other part of Blunderbase, works
exactly as before with no token at all.

Answers are cached in the server process — a day for masters, six hours for the rated pools,
a week for a fetched game — so stepping a board through an opening is one request per new
position and a restart forgets all of it.

## Deleting games

Games go from the library screen: the ✕ at the end of a row, or a selection and **Delete**
in the footer. A game takes its analysis, the notes written about it and the variations
kept off it; notes about a *position* stay, and so does the sync history — the cursor is
what stops the next sync starting over.

Deleting a game deletes the only record of it, and the importer deduplicates by looking in
the games table, so a deleted game would otherwise come straight back: chess.com re-reads
the archive month that is still being played on every sync. Each deleted game therefore
leaves a row in `deleted_games` — the source and its ID, plus the content hash that catches
the same game arriving as a PGN with no ID — and any import that meets it again leaves it
alone and counts it as **previously deleted**, apart from the games it skipped as
duplicates.

A sync normally starts where the last one stopped — Lichess and FICS resume from a stored
cursor, chess.com re-reads the month still being played. **From the beginning**, in the
strip above the sources grid, ignores that cursor and reads the whole archive (`since=all`
on the API and the CLI, which every account source understands). It is safe to press: games
already in the library are skipped as duplicates, and deleted games are refused by the
record below rather than quietly restored.

**Library → Manage → Deleted games** lists those records and is the only way back:
forgetting one lets the next import store that game again, as a new game with no analysis
and no notes. The card is not shown until something has been deleted. Resetting the whole
library writes no records at all — a reset means starting over, and a library of them would
block the re-import that follows.

## Export, backup and restore

**Library → Manage → Export PGN** downloads every stored game in one
`blunderbase-library.pgn`. Original PGN headers, comments and variations are preserved;
Blunderbase notes are comments and saved lines are variations. This is the portable copy
for chess software. It is not a lossless application backup: PGN cannot carry engine
evaluations, accounts, analysis settings or import cursors.

**Library → Manage → Download backup** creates the lossless, integrity-checked SQLite
copy. It includes games, annotations, analysis, accounts and settings, as well as
installation-local credentials and engine configuration. Store it like a password: hashes
and API-key hashes are not plaintext, but the file is still private. A backup may be taken
while Blunderbase is running; SQLite's online backup API includes all committed WAL
transactions in one consistent snapshot.
Restoration is deliberately not available in the running web app: it replaces the database
under the process and therefore remains an offline CLI operation.

```bash
uv run blunderbase db backup /safe/place/blunderbase-2026-09-01.db
# ... on the replacement installation, with Blunderbase stopped:
uv run blunderbase db restore /safe/place/blunderbase-2026-09-01.db --force
uv run blunderbase db upgrade
```

Both commands run SQLite's full integrity check, require a Blunderbase schema revision,
and print the byte count, revision and SHA-256. The backup and restore SHA-256 values must
match. Restore verifies the input before touching the configured database, installs it by
atomic rename, and refuses to replace an existing database without `--force`. Stop every
process using that database before restore; then start Blunderbase and confirm the Library
count. `db upgrade` is safe when restoring an older release and is a no-op at the current
revision.

For Docker, copy the verified backup out of the named volume rather than leaving the only
copy beside the live database:

```bash
docker exec blunderbase blunderbase db backup /data/blunderbase-backup.db
docker cp blunderbase:/data/blunderbase-backup.db ./blunderbase-backup.db

docker compose -f docker/docker-compose.yml stop blunderbase
docker cp ./blunderbase-backup.db blunderbase:/data/restore.db
docker compose -f docker/docker-compose.yml run --rm --no-deps \
  --entrypoint blunderbase blunderbase db restore /data/restore.db --force
docker compose -f docker/docker-compose.yml up -d blunderbase
```

## Commands

`uv run blunderbase …` — `serve`, `import <lichess|chesscom|fics|pgn> …`,
`accounts <list|add|reconcile>`, `analyze` (queue a
tier and drain it in this process), `mcp [--transport stdio|http]`, `set-password`,
`db upgrade`, `db backup`, `db restore`, `db rebuild-cards`, `db rebuild-stats`,
`db rebuild-book`, and
`demo create`. The
queue is `analysis_runs` rows rather than a broker, so `blunderbase analyze` is safe to
run while the server is up, and nothing is lost across a restart.

`db rebuild-cards` and `db rebuild-stats` recompute what a game keeps precomputed about its
own analysis — the card the games table draws, and the per-game summary every stats
dimension adds up. Neither is ever required: a finished run rewrites both for its own game,
and what is missing is computed the slow way on the way out. They are for a library
analysed before those columns existed, and `serve` already runs the summary sweep in the
background at boot, so the command is only for doing it now and watching it finish.

`db rebuild-book` is the same bargain for the opening explorer: it folds the continuations
of every position enough games reach to be worth writing down, and marks the rest as
deliberately left out. A position the book does not describe is folded live exactly as it
always was, so this buys speed rather than correctness — and `serve` runs this sweep in the
background too.

`accounts add lichess <username>` names a username as one of yours and claims the games
already stored under it — that is what fills in the colour, opponent and ratings of an
archive imported before any account said which player was you. `accounts reconcile` runs
the same repair for every account; it is idempotent, and never revises a game whose side
is already known.

`demo create` reads a varied sample of analyzed games from `BLUNDERBASE_DB_PATH` and writes
`<data-dir>/demo.db`. It takes 3,000 games unless `--games N` says otherwise; `--as-of
YYYY-MM-DD` pins the fake date range, `--from` or `--output` chooses either file, and
`--force` explicitly replaces an old output. It reconstructs PGNs without comments and
fabricates all identifying metadata; credentials and personal notes are never copied.

It writes no engine row and assigns no role: every game arrives with a completed Quick
pass, the numbers copied in, so nothing ever needs to run on the machine serving it. In
demo mode that is the whole story — the analysis board, Quick and Deep all run on browser
Stockfish in the visitor's own tab and are never sent to the server. `--runners` copies the
runner rows — name, slots and the token's hash, nothing else — so a runner that dials into
the source library dials into the demo with the token it has; that is for serving the demo
library as an *ordinary* deployment, where server engines are used as usual. Run the result
either way:

```bash
uv run blunderbase demo create --games 3000
BLUNDERBASE_DB_PATH=data/demo.db uv run blunderbase serve                              # yours, with a password
BLUNDERBASE_DB_PATH=data/demo.db BLUNDERBASE_RUNTIME_MODE=demo uv run blunderbase serve  # everyone's, read-only
```

## Cutting a release

```bash
make release v=0.2.0        # bump, commit, tag
make release v=0.2.0 DRY=1  # print what that would do, change nothing
```

The version lives in two places, `pyproject.toml` and `web/package.json`, and the target
moves both plus `uv.lock` in one `chore: release vX.Y.Z` commit, then adds an annotated
`vX.Y.Z` tag. Everything else reads one of those two: `blunderbase --version` via
`importlib.metadata`, the sidebar footer via Vite's `define`.

It refuses to run on a dirty tree, off `main`, on a version that is not `X.Y.Z`
(optionally `X.Y.Z-rc.1`), or when the tag already exists. Nothing is pushed until you
publish it:

```bash
make publish
```

Publishing pushes main and the tag, waits for that commit's main CI, then creates the
GitHub release and uploads the desktop installers `make desktop` left under
`desktop/dist` as `Blunderbase-macOS-arm64.dmg` and `Blunderbase-Windows-x64-setup.exe`.
Those names never change, because blunderbase.org's download buttons point at
`releases/latest/download/<name>`; publishing refuses to run without both installers for
the version being released unless `BB_SKIP_DESKTOP=1` is set, so the sequence is
`make desktop`, then `make publish`. The release builds the image once and publishes
`ghcr.io/philphilphil/blunderbase:0.2.0`, `:0.2`, `latest`, and `sha-<short>`.
If that build fails, dispatch `release.yml` with the existing tag to rebuild and deploy it;
dispatching it without a tag only redeploys the current `latest`. Deploying tells Komodo to
redeploy both stacks that run that image — `blunderbase` and the public demo beside it,
`blunderbase-demo` (`docs/deploy.md`, "A public demo").

## Testing

```bash
make test                                       # uv run pytest + pnpm test
uv run pytest -m slow                           # the seven that wait on a real clock
uv run pytest -m engine                         # the suite that wants a real binary
uv run pytest -n0                               # back on one process, for a breakpoint
```

Two markers are deselected from the default run, so that the run you type between edits
answers in seconds. **`engine`** wants a real Stockfish or Maia; the adapters are otherwise
covered by scripted fake UCI processes, so the default run needs no binary at all.
**`slow`** is seven tests that wait on a wall clock rather than on an event — a reconnect
window running out, a shutdown grace period — and were forty of the suite's hundred-odd
seconds. Worth running by hand after touching `backend/runners/`.

The default run also goes across your cores (`-n auto`, in `pyproject.toml`): the tests
share nothing but a temporary SQLite file apiece. Together with the markers that takes the
backend suite from about 140 seconds to under 20. Use `-n0` when you want a breakpoint.

CI runs both: the default suite and `-m slow`. `make publish` waits for both before opening
the release, so the tag that ships is a tag both passed on. `engine` runs nowhere but your
machine.
