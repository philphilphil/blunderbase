.PHONY: run backend web install test migrate mcp

# Start everything: backend (API + analysis workers) and the web app.
run: migrate
	@trap 'kill 0' EXIT INT TERM; \
	uv run blunderbase serve & \
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

mcp:
	uv run blunderbase mcp
