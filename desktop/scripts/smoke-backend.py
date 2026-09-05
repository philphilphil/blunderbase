"""Exercise the frozen backend with a disposable library before packaging an installer."""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> None:
    executable = Path(sys.argv[1]).resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="blunderbase-smoke-") as directory:
        root = Path(directory)
        database = root / "library.db"
        pgn = root / "game.pgn"
        # No source-supplied opening tags: this must read the bundled opening book.
        pgn.write_text(
            '[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n'
            '1. e4 e5 2. Nf3 Nc6 1-0\n',
            encoding="utf-8",
        )
        environment = {
            key: value for key, value in os.environ.items()
            if not key.upper().startswith("BLUNDERBASE_")
        }
        environment.update(
            BLUNDERBASE_DATA_DIR=str(root), BLUNDERBASE_DB_PATH=str(database),
        )
        subprocess.run(
            [str(executable), "import", "pgn", str(pgn)],
            cwd=root, env=environment, check=True, timeout=60,
        )
        # A per-game import failure still exits zero; inspect the result, not just the exit.
        with sqlite3.connect(database) as connection:
            job = connection.execute(
                "SELECT status, games_imported, games_failed, errors FROM import_jobs"
            ).fetchone()
            if job is None or job[:3] != ("done", 1, 0):
                raise RuntimeError(f"packaged backend could not import the smoke game: {job}")
            opening = connection.execute("SELECT eco, opening_name FROM games").fetchone()
            if opening is None or not all(opening):
                raise RuntimeError(f"packaged backend could not name the opening: {opening}")
    print("Packaged backend smoke test passed: migrated, imported, and named an opening.")


if __name__ == "__main__":
    main()
