# syntax=docker/dockerfile:1

# One image, one port, one process: the API, the `/events` socket, the built web app and
# — when a bearer key is set — the MCP transport are all served by the same uvicorn.
#
# Built from the repository root, not from this folder — every COPY below is root-relative:
#   docker build -f docker/Dockerfile .
# The compose files beside this one set that context, and `Dockerfile.dockerignore` is the
# allowlist BuildKit applies to it.

FROM node:22-bookworm-slim AS web-build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=1
WORKDIR /app/web
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
# The manifests alone decide the dependency layer, so editing a component does not
# reinstall node_modules.
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web ./
# The browser engine's neural net is downloaded here, into the image, rather than by the
# page that uses it: an instance on a network with no way out — or simply one whose owner
# would rather not have a page reach fishtest — still gets a working engine, and the file is
# then served from the same origin as everything else. It is pinned by sha256 in
# `scripts/engine-assets.mjs`, so this layer cannot silently change under a rebuild; the
# build below runs the same command and finds the cache warm.
RUN node scripts/engine-assets.mjs fetch
# No VITE_API_BASE: the client's default `/api` is what the backend serves the routers
# under, so every request the browser makes is same-origin. Baking a host in here is what
# breaks a hosted instance — the page would call the visitor's own machine.
RUN pnpm build

FROM python:3.12-slim-bookworm AS python-deps
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON=/usr/local/bin/python3.12 \
    UV_PYTHON_DOWNLOADS=never
WORKDIR /app
# Dependencies resolve from the manifests alone. README.md is deliberately not here even
# though pyproject declares it as the readme: `--no-install-project` does not build this
# package, so every documentation edit would otherwise invalidate this whole layer.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
# Building the project itself does need the readme.
COPY backend ./backend
COPY README.md ./
RUN uv sync --frozen --no-dev

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH=/app/.venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games \
    BLUNDERBASE_DATA_DIR=/data \
    BLUNDERBASE_DB_PATH=/data/blunderbase.db \
    BLUNDERBASE_WEB_DIST=/app/web/dist \
    BLUNDERBASE_HOST=0.0.0.0 \
    BLUNDERBASE_PORT=8765

# Stockfish ships (Debian's package puts it at /usr/games/stockfish; the symlink is what
# makes the bare name resolve for a `stockfish` engine row). Maia is an lc0 build with
# its own weights and stays out: register it against a mounted binary instead.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl stockfish; \
    rm -rf /var/lib/apt/lists/*; \
    stockfish_bin="$(command -v stockfish || echo /usr/games/stockfish)"; \
    test -x "$stockfish_bin"; \
    ln -sf "$stockfish_bin" /usr/local/bin/stockfish; \
    groupadd --system --gid 10001 blunderbase; \
    useradd --system --uid 10001 --gid 10001 --create-home --home-dir /home/blunderbase \
        --shell /usr/sbin/nologin blunderbase

WORKDIR /app
COPY --from=python-deps /app/.venv ./.venv
COPY --from=web-build /app/web/dist ./web/dist
COPY backend ./backend
COPY docker ./docker
COPY alembic.ini pyproject.toml README.md ./

# The database lives on the volume, not here; `ensure_directories()` still has to be able
# to create whatever BLUNDERBASE_DATA_DIR points at without being root.
RUN chmod +x docker/entrypoint.sh && install -d -o blunderbase -g blunderbase /data

VOLUME ["/data"]
EXPOSE 8765
USER blunderbase

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8765/health || exit 1

ENTRYPOINT ["/app/docker/entrypoint.sh"]
