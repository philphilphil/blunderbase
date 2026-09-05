# Contributing

How this repository is built and shipped: the manual, translations, the vendored opening
names, cutting a release, running the tests. Nothing here says how Blunderbase is *used* or
*operated* — that is the manual's, and only the manual's. The system design is in
[ARCHITECTURE.md](ARCHITECTURE.md), the decisions behind it in [adr/](adr).

## Working on it

Prerequisites: Python 3.12+, uv, Node 22+, pnpm.

```bash
make install          # uv sync + pnpm install
make run              # migrations, API + /events + /mcp on :8765, Vite on :5273
make engines          # register this machine's Stockfish (and Maia) as local engines
make test             # uv run pytest + pnpm test
```

## The manual

`manual/` is the user and operator manual, and it is the truth for anything a person sees
or operates: a screen, a setting, a keyboard shortcut, a CLI flag, a yaml key, an
environment variable. It is MkDocs Material, configured by `mkdocs.yml` at the repository
root.

```bash
make docs         # build into manual-site/, --strict
make docs-serve   # the same with a live-reloading server on :8000
```

The Guide mirrors the app's rail one to one: one chapter per rail entry, in the rail's
order, and inside a chapter the H2s follow that screen's sections and controls in the order
they appear on it — nothing from another screen is described there, only linked.

`manual/en` and `manual/de` are the two language trees, and every page exists in both. The
German is written as German, not translated sentence by sentence — the first attempt at
that read like nonsense and was thrown out. A German page keeps the same headings in the
same order, and each is pinned to the English heading's slug with attr_list
(`## Verwalten { #manage }`), so a link to an anchor — from the manual or from the (?) in
the app — lands on the same section in either language. The build validates anchors, so a
missing one fails `make docs`. Should a German page ever be missing, the i18n plugin falls
back to the English one.

The build lands in `manual-site/`, which is what the backend serves at `/manual/` without a
login and what `scripts/site.sh` puts under blunderbase.org/manual/. Both come from this one
source, so the manual in a running container is the manual for that version.

`tests/test_manual_content.py` derives every `Settings` field and every argparse subcommand
from the code and fails when one of them is not written down in `manual/en/operate/`. A new
setting or command is not finished until it is in the manual.

## Languages

The web app speaks English and German; what that means for a reader is in the manual. This
is how it is built.

[Lingui](https://lingui.dev). The English text in a component *is* the source string —
`<Trans>Nothing to analyse yet</Trans>`, `` t`Save note` `` — and its message id is derived
from it, so there is no key file to keep in step with the code. Four forms, and which one
depends only on where the string sits:

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

Only the web app is translated. The MCP tools, the backend's error text and the CLI stay
English: an assistant reads those, not a person, and a coach that is handed a German tool
description answers worse. The landing page has a German copy at `/de/`
(`site/de/index.html`), written by hand rather than generated.

**Adding a language.** Add its tag to `locales` in `web/lingui.config.ts` and to `LOCALES`
and `LOCALE_NAMES` in `web/src/lib/i18n/locale.ts` (the name is in the language itself),
run `pnpm i18n`, translate `web/src/locales/<tag>/messages.po`, and add the tag to
`isLocale`. Number and date formatting follows the browser, not the chosen language, so
nothing else changes. A language the manual is also written in needs its locale adding to
the `i18n` plugin in `mkdocs.yml` and a tree under `manual/<tag>`.

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
GitHub release and uploads the desktop installers `make desktop` left under `desktop/dist`
as `Blunderbase-<version>-macOS-arm64.dmg` and `Blunderbase-<version>-Windows-x64-setup.exe`.
The version is in the name so a downloaded file still says which Blunderbase it is, and does
not collide with the last one somebody kept; the cost is that nothing can link a fixed URL,
since `releases/latest/download/<name>` only redirects to a name known in advance — so
blunderbase.org's two download buttons go to the release page instead of straight at a file.
Publishing refuses to run without both installers for the version being released unless
`BB_SKIP_DESKTOP=1` is set, so the sequence is `make desktop`, then `make publish`. The release builds the image once and publishes
`ghcr.io/philphilphil/blunderbase:0.2.0`, `:0.2`, `latest`, and `sha-<short>`.
If that build fails, dispatch `release.yml` with the existing tag to rebuild and deploy it;
dispatching it without a tag only redeploys the current `latest`. Deploying tells Komodo to
redeploy both stacks that run that image — `blunderbase` and the public demo beside it,
`blunderbase-demo`.

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
