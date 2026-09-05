.PHONY: run run-demo backend web desktop desktop-macos desktop-windows ios ios-test install test migrate engines mcp mcp-http mcp-key release publish site docs docs-serve

# The recipes are POSIX sh (mkdir -p, trap, &, wait). On a Windows checkout make would
# otherwise hand them to cmd.exe, where `mkdir -p data` creates a folder called `-p`.
ifeq ($(OS),Windows_NT)
export PATH := C:\Program Files\Git\usr\bin;$(PATH)
SHELL := sh.exe
endif

# Machine-local settings, if this checkout has any: `MAIA=…` and friends, one per line.
# Gitignored, optional, and read before the defaults below so it can override them.
-include .env

KEY_FILE := data/mcp.key
key = $$(cat $(KEY_FILE))

$(KEY_FILE):
	@mkdir -p data
	@openssl rand -hex 32 > $(KEY_FILE)
	@echo "generated MCP bearer key in $(KEY_FILE)"

# Start everything: backend (API + analysis workers + MCP at /mcp) and the web app.
# MCP shares the serve process so the coach drives the same live board the browser sees.
run: migrate $(KEY_FILE)
	@trap 'kill 0' EXIT INT TERM; \
	BLUNDERBASE_MCP_BEARER_KEY=$(key) uv run blunderbase serve & \
	cd web && pnpm dev & \
	wait

backend: migrate
	uv run blunderbase serve

web:
	cd web && pnpm dev

# A full desktop build is two builds on two operating systems: the macOS bundles here, the
# NSIS installer in the `desktop-windows` workflow, because nothing cross-compiles it. The
# workflow run is started first and collected last so it overlaps the local build instead of
# following it. `make desktop-macos` is the same local half without GitHub in the way.
# Both installers end up under desktop/dist — the .dmg in mac/, the .exe in windows/.
desktop: docs
	sh desktop/scripts/windows-ci.sh dispatch
	cd desktop && pnpm build
	sh desktop/scripts/windows-ci.sh collect

desktop-macos: docs
	cd desktop && pnpm build

desktop-windows:
	sh desktop/scripts/windows-ci.sh

# The iOS Companion. Its .xcodeproj is generated from ios/project.yml and not checked in,
# so every entry point regenerates it first. macOS only, and it needs Xcode and xcodegen.
IOS_SIM ?= iPhone 17 Pro

ios:
	cd ios && xcodegen generate && open Blunderbase.xcodeproj

ios-test:
	cd ios && xcodegen generate
	cd ios && xcodebuild -scheme Blunderbase -destination 'platform=iOS Simulator,name=$(IOS_SIM)' test

install:
	uv sync
	cd web && pnpm install
	cd desktop && pnpm install

migrate:
	uv run blunderbase db upgrade

test:
	uv run pytest
	cd web && pnpm test

# Point the dev database at this machine's own Stockfish and Maia, and give them the three
# roles, so `make run` analyses with real engines instead of the WASM build a browser tab
# carries. Local engine rows, not a runner: the binaries are on this host, so the serve
# process can start them itself and there is no token, no yaml and no container in the way.
#
#   make engines
#   make engines MAIA=~/engines/maia3/bin/maia3-5m MAIA_MODELS=~/engines/maia3/models
#
# Idempotent — `--replace` re-probes the binary and rewrites the row, so running it again
# after moving or upgrading one is the whole fix.
#
# Neither path has to be given. `engines/` at the repo root is gitignored and is where a
# downloaded engine belongs, so a Maia under it is found without being named — and the
# layout is the container's own (`engines/docker/Dockerfile` builds `/engines/maia3/bin`
# and `/engines/maia3/models`), which means the same two paths work here and in the image.
# Failing that, PATH. Failing that, a `MAIA=` line in `.env` beside this file. The
# `$(shell)` below runs only when this target expands it, not on every `make`.
SF ?= stockfish
SF_THREADS ?= 4
MAIA ?= $(firstword $(wildcard engines/maia3/bin/maia3-5m) $(shell command -v maia3-5m 2>/dev/null))
MAIA_MODELS ?= $(firstword $(wildcard engines/maia3/models))
# `--local-files-only` only makes sense with a cache to read, so the two travel together;
# without one, maia3 resolves its weights however it normally would.
MAIA_ARGS = --use-uci-history$(if $(MAIA_MODELS), --cache-dir $(MAIA_MODELS) --local-files-only,)

engines: migrate
	uv run blunderbase engines add stockfish-local "$(SF)" \
		--option Threads=$(SF_THREADS) --role quick --role deep --replace
	@if [ -n "$(MAIA)" ]; then \
		uv run blunderbase engines add maia-local "$(MAIA) $(MAIA_ARGS)" \
			--kind maia --role human --replace; \
	else \
		echo "maia: no maia3-5m under engines/ or on PATH, so human moves stay unassigned."; \
		echo "     make engines MAIA=/path/to/maia3-5m MAIA_MODELS=/path/to/models"; \
		echo "     or put MAIA= and MAIA_MODELS= in .env beside this Makefile."; \
	fi
	@echo
	@uv run blunderbase engines list

# stdio transport, for local MCP clients (Claude Code / Claude Desktop)
mcp:
	uv run blunderbase mcp

mcp-http: $(KEY_FILE)
	BLUNDERBASE_MCP_BEARER_KEY=$(key) uv run blunderbase mcp --transport http

# Print what a remote MCP client needs (the /mcp mount inside `make run`'s serve process)
mcp-key: $(KEY_FILE)
	@echo "URL:    http://127.0.0.1:8765/mcp"
	@echo "Header: Authorization: Bearer $(key)"

# `make release v=0.2.0` (or `make release v0.2.0`) — move the version, commit it, tag it.
# The work is in scripts/release.sh; what has to live here is only make's half of the
# argument, since `v0.2.0` arrives as a goal rather than a variable. `DRY=1` says what
# would happen and stops.
#
# Invoked through `sh` rather than by its shebang: the executable bit does not survive a
# Windows checkout, and this is a repository that gets released from one.
release:
	@BB_V='$(v)' BB_DRY='$(DRY)' sh scripts/release.sh $(filter v%,$(MAKECMDGOALS))

# `make publish` — push the tag `make release` cut and open the GitHub release that
# ships it. This is the step that leaves the machine: the release is what builds the
# image, moves `latest` and tells Komodo to pull. `DRY=1` shows the notes and stops.
publish:
	@BB_DRY='$(DRY)' sh scripts/publish.sh

# `make release v0.2.0` names the version as a goal; this swallows it so make does not go
# looking for a rule to build it. Nothing else in here is spelled v-something.
v%: ; @:

# Assemble the landing page (site/index.html plus the screenshots and brand assets) into
# site/dist, to open in a browser. Workers Builds runs the same script to publish
# blunderbase.org (site/README.md, "Hosting").
site:
	@sh scripts/site.sh

# The manual (mkdocs.yml at the root): markdown under manual/en and manual/de, a static
# site in manual-site/. `--strict` is the point of the target — it fails on a cross-link
# to a page or an anchor that is not there, which is the only thing that catches a manual
# rotting as the app moves.
#
# `--group docs` rather than a default group: `uv sync --no-dev` in the Dockerfile drops
# the `dev` group and nothing else, so a docs group installed by default would put MkDocs
# and Material in the production image.
docs:
	uv run --group docs mkdocs build --strict

# The same with a live-reloading server on :8000, for writing.
docs-serve:
	uv run --group docs mkdocs serve

# The public demo, locally: `demo create` on this checkout's own library, then the same two
# processes as `run`, on the same two ports — localhost:5273 is the address to look at the
# demo in, so this replaces `make run` rather than sitting beside it, and scripts/run_demo.py
# says so if one is already up. Every game in it arrives analysed and the library holds no
# engine, so nothing searches on this machine's behalf — the analysis board is browser
# Stockfish, in the tab, writing nothing back. The database is built once and kept; delete
# data/demo.db to rebuild it from newer games. `migrate` is order-only (after the `|`): it
# is phony, so as a normal prerequisite it would make the file look stale on every run and
# `demo create` refuses to overwrite.
DEMO_DB := data/demo.db

$(DEMO_DB): | migrate
	uv run blunderbase demo create --output $(DEMO_DB)

run-demo: $(DEMO_DB)
	uv run python scripts/run_demo.py
