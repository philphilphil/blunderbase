.PHONY: run backend web install test migrate mcp mcp-http mcp-key

KEY_FILE := data/mcp.key
key = $$(cat $(KEY_FILE))

$(KEY_FILE):
	@mkdir -p data
	@openssl rand -hex 32 > $(KEY_FILE)
	@echo "generated MCP bearer key in $(KEY_FILE)"

# Start everything: backend (API + analysis workers), MCP over HTTP, and the web app.
run: migrate $(KEY_FILE)
	@trap 'kill 0' EXIT INT TERM; \
	uv run blunderbase serve & \
	BLUNDERBASE_MCP_BEARER_KEY=$(key) uv run blunderbase mcp --transport http & \
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

# Print what a remote MCP client needs
mcp-key: $(KEY_FILE)
	@echo "URL:    http://127.0.0.1:8766/mcp"
	@echo "Header: Authorization: Bearer $(key)"
