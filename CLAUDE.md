# Blunderbase — project instructions

A personal chess database with an AI coach: games are imported, Stockfish (and Maia) run
over every one as it arrives, and a web app and an MCP server read the same store. One
owner, one password, one container. `README.md` is the front page; the docs under `docs/`
are the detail (see "Where things are").

## Stack

- **Backend** `backend/` — Python 3.12, FastAPI, SQLAlchemy 2 (sync), Alembic, SQLite in
  WAL mode. Package manager is **uv**; `pyproject.toml` + `uv.lock` are the manifests.
- **Frontend** `web/` — React 19 + TypeScript, Vite, Tailwind CSS 4, shadcn/Radix,
  chessground + chessops. Package manager is **pnpm** (10.33.0, pinned in `Dockerfile`
  and CI). Lint is oxlint, tests are vitest + testing-library.
- **MCP** is built into the backend (`backend/mcp/`), stdio for local clients and
  streamable HTTP at `/mcp` inside the serve process.
- **Ship** — `docker/` holds the Dockerfile, both compose files and the entrypoint. The
  image is built from the repository root (`docker build -f docker/Dockerfile .`). A GitHub
  release builds and pushes `ghcr.io/philphilphil/blunderbase` and tells Komodo to redeploy.

## Commands

```bash
make install          # uv sync + pnpm install
make run              # migrate, backend on :8765 (API + /events + /mcp), Vite on :5273
make engines          # this machine's Stockfish/Maia as local engine rows, holding the roles
make test             # uv run pytest + pnpm test
uv run ruff check backend tests           # what CI lints
cd web && pnpm lint && pnpm typecheck     # what CI checks on the frontend
uv run pytest -m engine                   # tests that want a real Stockfish/Maia binary (not in CI)
uv run pytest -m slow                     # the seven clock-waiting runner tests (CI runs these)
uv run alembic revision --autogenerate -m "..."   # new migration; alembic.ini at the root is for this
```

Run the relevant suite before calling a change done. Frontend tests live beside the file
they test (`Foo.test.tsx` next to `Foo.tsx`); backend tests live in `tests/`.

## Architecture rules (the ones that bite)

Full reasoning in `docs/ARCHITECTURE.md`. The short version:

- **`backend/services/` is the only place business logic lives.** A "blunder", a "recent
  game", a stat — defined once, there. `api/` and `mcp/` are thin wrappers over services
  and never import `backend.db.models`, write a query or open their own Session. That is
  what keeps the browser and the coach from disagreeing.
- Nothing in `services/` imports FastAPI or the MCP SDK; every service function takes an
  explicit `Session` as its first argument.
- `backend/adapters/` (Lichess, chess.com, PGN, UCI engines, Maia) knows nothing about the
  database — it fetches, parses or drives a subprocess and hands back plain data.
- The database layer is **sync** SQLAlchemy. Workers are asyncio tasks that do DB work in a
  thread (`asyncio.to_thread`), never through an async Session.
- Migrations use `render_as_batch=True` (SQLite). A run's budget is copied onto the run
  row when it is queued, not looked up when it executes.
- Analysis has two tiers, `quick` and `deep`; both add a Maia pass when a Maia engine is
  enabled. A `maia_only` run is a fill pass that adds levels to an already-evaluated game.

## Frontend conventions

- **Colours come from `web/src/index.css` only.** Every colour is a `--bb-*` token with a
  semantic alias (`bg-elevated`, `text-dim`, `border-edge-strong`, …); no component names a
  hex. Dark is the default theme, `:root.light` overrides. Design source: `docs/design/`.
- Components carry a doc comment saying *why* they are shaped the way they are; keep that
  habit — the reasoning is the part that is not obvious from the JSX.
- Native `select`/`textarea` styled with Tailwind is the norm over heavy widgets.
- **Every string a person reads goes through Lingui.** `<Trans>` for JSX text, `useLingui()`'s
  `t` for props and toasts, `msg` for labels in module-level tables, the global `t` only in
  helpers with no React. English is the source text; `pnpm i18n` refreshes the catalogs under
  `web/src/locales/` and CI fails when they are stale. Details in `docs/reference.md`.
- `web/src/lib/api/` is the typed client; `web/src/lib/events/` handles the `/events`
  WebSocket and query invalidation.
- `web/src/lib/board/linePreview.ts` is the only place engine-line-preview shapes are
  computed; components pass it prefs and a hover state and hand what comes back to chessground.

## Where things are

| Need | Look in |
|------|---------|
| Code shape, invariants, why sync SQLAlchemy | `docs/ARCHITECTURE.md` |
| Auth, engines, configuration, CLI, releases, testing | `docs/reference.md` |
| Reverse proxy / TLS in front of the container | `docs/deploy.md` |
| Remote engine runners (yaml, container, troubleshooting) | `docs/runners.md` |
| Design tokens, layout decisions, brand assets | `docs/design/README.md` |
| Image, compose files, entrypoint (the public demo is `docker-compose.demo.yml`) | `docker/` |
| CI and the release-to-deploy pipeline | `.github/workflows/` |
| The landing page at blunderbase.org (static, Cloudflare Workers Builds, `make site` to assemble) | `site/`, `scripts/site.sh` |

## Working here

- Small, whole changes. Do not leave TODOs for the next agent; either do the thing or say
  in the reply what was left out and why.
- Edit files with the Edit tool; never rewrite an existing file with a script. Development
  is mostly on macOS and sometimes on a Windows checkout with `core.autocrlf=true`, where a
  whole-file rewrite flips line endings and shows up as a bogus diff. `*.sh` is forced to
  LF by `.gitattributes` because `docker/entrypoint.sh` and `scripts/*.sh` run under `sh`.
- Do not commit unless asked. When asked, plain imperative subjects in the style of the
  log (`fix(web): …`, `chore: …`).
- **Do not drive the app in a browser.** No Playwright, no browser automation, no starting
  a server to click through the UI. Run `make test` and the lint/typecheck commands above,
  say plainly what that does and does not prove, and then hand it to the owner to try —
  and wait for their answer before going further. The owner is at a real browser and the
  app is one keystroke away for them; an agent driving a second copy is slower, tests a
  browser nobody uses, and fights the owner's own `make run` for port 8765. If a change
  can only be judged in a browser, say so and stop there.
- **Releases are always triggered by the owner.** Never write the changelog, run
  `make release` or `make publish` on your own initiative — only when told to, and then
  follow the steps below.
- Do not touch `CHANGELOG.md` per commit — see below.

## Changelog

`CHANGELOG.md` keeps one short line per change, newest first, under `## Unreleased`.

- Release-notes style. Every line starts with Added / Fixed / Changed / Removed and names the feature in a few words, under ten: "Added a clear button for the analysis queue", "Fixed the queue widget refreshing several times a second". No scopes, no file names, no sub-bullets, no explaining how it works. An upgrade step the owner must run may follow in parentheses.
- Fold related commits into one line; leave out refactors and chores nobody would notice.
- Write the changelog only when the owner asks for a release, and by hand — no script touches it. Collect what shipped since the last tag into short lines, put them under a `## vX.Y.Z — YYYY-MM-DD` heading (keep an empty `## Unreleased` above), commit that, then run `make release vX.Y.Z` (or `v=X.Y.Z`) to move the version and tag. Then `make desktop` builds both installers, and `make publish` pushes the tag, opens the GitHub release and uploads them named after the version (blunderbase.org links the release page, not a file) — that release, not the tag, is what builds and pushes the image and tells Komodo to redeploy, so nothing ships until you run it. The release body is CHANGELOG.md's `## vX.Y.Z` section verbatim, which is why the notes are written before the version moves and why `make publish` refuses a version that has none. Do not add entries commit-by-commit.
