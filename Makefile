.PHONY: run backend web install test migrate mcp mcp-http mcp-key release

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

install:
	uv sync
	cd web && pnpm install

migrate:
	uv run blunderbase db upgrade

test:
	uv run pytest
	cd web && pnpm test

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
#
# The number lives in pyproject.toml and web/package.json; uv.lock restates the first and
# is relocked rather than hand-edited. Everything else reads one of those: the backend via
# importlib.metadata, the sidebar footer via Vite's `define`.
#
# CHANGELOG.md's `## Unreleased` bullets become the section for the version being cut, and
# a fresh empty `## Unreleased` opens above it. No bullets, no release.
#
# The push is deliberately not done here — the tag is the release, and you should look at
# it before it leaves the machine. `DRY=1` says what would happen and stops.
release:
	@set -eu; \
	version="$(v)"; \
	goals="$(filter v%,$(MAKECMDGOALS))"; \
	case "$$goals" in \
	  *" "*) echo "release: '$$goals' names more than one version" >&2; exit 1;; \
	esac; \
	if [ -n "$$goals" ]; then \
	  if [ -z "$$version" ]; then \
	    version="$${goals#v}"; \
	  elif [ "$$version" != "$${goals#v}" ]; then \
	    echo "release: v=$$version and $$goals disagree; give one version" >&2; exit 1; \
	  fi; \
	fi; \
	if [ -z "$$version" ]; then \
	  echo "release: needs a version, e.g. make release v=0.2.0" >&2; exit 1; \
	fi; \
	case "$$version" in \
	  v*) echo "release: drop the leading v — make release v=$${version#v}" >&2; exit 1;; \
	esac; \
	if ! echo "$$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$$'; then \
	  echo "release: '$$version' is not X.Y.Z (optionally X.Y.Z-suffix)" >&2; exit 1; \
	fi; \
	tag="v$$version"; \
	branch=$$(git rev-parse --abbrev-ref HEAD); \
	if [ "$$branch" != "main" ]; then \
	  echo "release: HEAD is on '$$branch'; releases are cut from main" >&2; exit 1; \
	fi; \
	if [ -n "$$(git status --porcelain)" ]; then \
	  echo "release: the working tree is dirty; commit or stash first" >&2; exit 1; \
	fi; \
	if git rev-parse -q --verify "refs/tags/$$tag" >/dev/null; then \
	  echo "release: $$tag already exists" >&2; exit 1; \
	fi; \
	was_py=$$(sed -n 's/^version = "\(.*\)"/\1/p' pyproject.toml | head -1); \
	was_web=$$(sed -n 's/^  "version": "\(.*\)",/\1/p' web/package.json | head -1); \
	entries=0; \
	if [ -f CHANGELOG.md ]; then \
	  entries=$$(sed -n '/^## Unreleased$$/,/^## /{/^- /p;}' CHANGELOG.md | wc -l | tr -d ' '); \
	fi; \
	if [ "$$entries" -eq 0 ]; then \
	  echo "release: CHANGELOG.md has no entries under ## Unreleased" >&2; exit 1; \
	fi; \
	heading="## $$tag — $$(date +%F)"; \
	if [ -n "$(DRY)" ]; then \
	  echo "release: dry run for $$tag — nothing written"; \
	  echo "  pyproject.toml    $$was_py -> $$version"; \
	  echo "  web/package.json  $$was_web -> $$version"; \
	  echo "  uv.lock           relocked"; \
	  echo "  CHANGELOG.md      $$entries entries move under \"$$heading\""; \
	  echo "  git commit -m \"chore: release $$tag\" && git tag -a $$tag"; \
	  exit 0; \
	fi; \
	BB_VERSION="$$version" perl -0pi \
	  -e 's/(\[project\][^\[]*\nversion = ")[^"]*(")/$$1$$ENV{BB_VERSION}$$2/' pyproject.toml; \
	BB_VERSION="$$version" perl -pi \
	  -e 's/^(  "version": ")[^"]*(")/$$1$$ENV{BB_VERSION}$$2/' web/package.json; \
	grep -q "^version = \"$$version\"$$" pyproject.toml \
	  || { echo "release: pyproject.toml's version key did not move" >&2; exit 1; }; \
	grep -q "^  \"version\": \"$$version\",$$" web/package.json \
	  || { echo "release: web/package.json's version key did not move" >&2; exit 1; }; \
	BB_HEADING="$$heading" perl -pi \
	  -e 's/^## Unreleased$$/## Unreleased\n\n$$ENV{BB_HEADING}/' CHANGELOG.md; \
	grep -q "^$$heading$$" CHANGELOG.md \
	  || { echo "release: CHANGELOG.md's Unreleased section did not move" >&2; exit 1; }; \
	uv lock --quiet; \
	git add pyproject.toml web/package.json uv.lock CHANGELOG.md; \
	if git diff --cached --quiet; then \
	  echo "release: already at $$version; tagging the commit that set it"; \
	else \
	  git commit -q -m "chore: release $$tag"; \
	fi; \
	git tag -a "$$tag" -m "Blunderbase $$tag"; \
	echo "release: $$tag committed and tagged locally. Publish it with"; \
	echo "  git push origin main --follow-tags"

# `make release v0.2.0` names the version as a goal; this swallows it so make does not go
# looking for a rule to build it. Nothing else in here is spelled v-something.
v%: ; @:
