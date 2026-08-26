#!/bin/sh
# Migrations first, then the server. The API lifespan also brings the database to head,
# but doing it here means a schema failure is the container's exit code rather than a
# stack trace inside a process that has already opened its port.
set -eu

blunderbase db upgrade

exec blunderbase serve --host "${BLUNDERBASE_HOST:-0.0.0.0}" --port "${BLUNDERBASE_PORT:-8765}"
