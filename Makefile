.PHONY: run backend web install test migrate mcp mcp-http mcp-key release publish

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
