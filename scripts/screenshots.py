"""Take the screenshots the README and blunderbase.org show, from the demo library.

    uv run --with playwright==1.63.0 python scripts/screenshots.py [--out DIR] [--only NAME ...]

`make screenshots` is the same with the defaults. Every scene is shot twice, `<name>-dark.png`
and `<name>-light.png`, at 1920×1080 CSS pixels and a device scale of 2 — 3840×2160, the
size the pages declare on their `<img>` tags — into `docs/screenshots/`, where the README
reads them and `scripts/site.sh` copies them from.

Why the demo and not the owner's library: its names, ratings and notes are already
anonymised (`blunderbase demo create`), it refuses every write so a shot can never change
anything, and anyone with this checkout can rebuild it. It is served the way the Docker
image serves itself — the built web app from `web/dist` inside the API process — on a port
of its own, so it runs beside `make run` instead of replacing it the way `make run-demo`
does.

The scenes are a table below rather than clicks recorded somewhere else: the game and the
ply are read out of the demo database (the first game that carries a note on a position),
so a rebuilt demo still lands on a position with something written about it. The phone
shots are not here; they come from the iOS simulator (`make ios-run`, then `make ios-shot`).
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "data" / "demo.db"
DIST = ROOT / "web" / "dist"
OUT = ROOT / "docs" / "screenshots"
VIEWPORT = {"width": 1920, "height": 1080}
SCALE = 2
# What the app keeps in the browser, set before the first script runs: the theme, the
# tour marked as seen (the demo keeps that in localStorage, `lib/tour/demoSeen.ts`) and the
# Hide engine switch (`lib/ui/engineVisibility.ts`), which a scene may turn on.
THEME_KEY = "blunderbase.theme"
TOUR_KEY = "blunderbase.tourSeen"
ENGINE_HIDDEN_KEY = "blunderbase.engineHidden"
# Long enough for chessground's move animation and the charts' first transition, which
# finish after the network has gone quiet.
SETTLE_MS = 1200


@dataclass(frozen=True)
class Hero:
    """The position the game, quiet-game and explorer scenes share."""

    game_id: int
    ply: int
    line: tuple[str, ...]


@dataclass(frozen=True)
class Scene:
    name: str
    path: Callable[[Hero], str]
    # localStorage entries beyond the theme and the tour, as strings.
    storage: dict[str, str] = field(default_factory=dict)
    # A selector that is on the page once the scene has what it is meant to show.
    ready: str = "main"


SCENES: tuple[Scene, ...] = (
    Scene("game", lambda h: f"/games/{h.game_id}?ply={h.ply}", ready=".cg-wrap"),
    Scene(
        "game-quiet",
        lambda h: f"/games/{h.game_id}?ply={h.ply}",
        storage={ENGINE_HIDDEN_KEY: "true"},
        ready=".cg-wrap",
    ),
    Scene("notes", lambda h: "/notes"),
    Scene("explorer", lambda h: "/explorer?line=" + ",".join(h.line), ready=".cg-wrap"),
    Scene("dashboard", lambda h: "/"),
    Scene("games", lambda h: "/games"),
    Scene("stats", lambda h: "/stats"),
)


def pick_hero(path: Path) -> Hero:
    """The first game in the demo with a note on one of its positions, at that note's ply."""
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as connection:
        row = connection.execute(
            "select n.game_id, n.ply, g.moves_uci from notes n join games g on g.id = n.game_id"
            " where n.ply is not null order by n.id limit 1"
        ).fetchone()
    if row is None:
        raise RuntimeError("the demo library has no note on a game position to shoot")
    game_id, ply, moves = row
    return Hero(game_id=game_id, ply=ply, line=tuple(json.loads(moves)[:ply]))


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def serve(port: int) -> subprocess.Popen:
    env = {
        **os.environ,
        "BLUNDERBASE_DB_PATH": str(DEMO),
        "BLUNDERBASE_RUNTIME_MODE": "demo",
        "BLUNDERBASE_ANALYSIS_WORKERS": "false",
    }
    server = subprocess.Popen(
        # This interpreter rather than `uv run`, which would sit between the signal and the
        # server; `uv run --with playwright` has already put the project on its path.
        [sys.executable, "-m", "backend.cli", "serve", "--host", "127.0.0.1", "--port", str(port)],
        cwd=ROOT,
        env=env,
    )
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if server.poll() is not None:
            raise RuntimeError(f"the server exited with {server.returncode}")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1):
                return server
        except OSError:
            time.sleep(0.3)
    server.terminate()
    raise RuntimeError("the server did not answer /health within a minute")


def shoot(page: Page, url: str, scene: Scene, target: Path) -> None:
    page.goto(url)
    page.wait_for_load_state("networkidle")
    page.wait_for_selector(scene.ready)
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(SETTLE_MS)
    # The pointer rests off the page, so no hover state or tooltip is in the picture.
    page.mouse.move(0, VIEWPORT["height"] - 1)
    page.screenshot(path=str(target))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument("--only", nargs="+", metavar="NAME", help="shoot these scenes only")
    parser.add_argument("--theme", choices=("dark", "light"), help="one theme instead of both")
    args = parser.parse_args()

    if not DEMO.exists():
        print("screenshots: no data/demo.db — run `make data/demo.db` first", file=sys.stderr)
        return 1
    if not (DIST / "index.html").exists():
        print("screenshots: no web/dist — run `cd web && pnpm build` first", file=sys.stderr)
        return 1
    scenes = [s for s in SCENES if not args.only or s.name in args.only]
    unknown = set(args.only or ()) - {s.name for s in SCENES}
    if unknown:
        print(f"screenshots: no scene called {', '.join(sorted(unknown))}", file=sys.stderr)
        return 1
    themes = [args.theme] if args.theme else ["dark", "light"]
    hero = pick_hero(DEMO)
    args.out.mkdir(parents=True, exist_ok=True)

    port = free_port()
    server = serve(port)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            for theme in themes:
                for scene in scenes:
                    storage = {THEME_KEY: theme, TOUR_KEY: "true", **scene.storage}
                    context = browser.new_context(
                        viewport=VIEWPORT,
                        device_scale_factor=SCALE,
                        color_scheme=theme,
                        locale="en-GB",
                    )
                    context.add_init_script(
                        f"for (const [k, v] of Object.entries({json.dumps(storage)}))"
                        " localStorage.setItem(k, v)"
                    )
                    page = context.new_page()
                    target = args.out / f"{scene.name}-{theme}.png"
                    shoot(page, f"http://127.0.0.1:{port}{scene.path(hero)}", scene, target)
                    print(f"wrote {target}")
                    context.close()
            browser.close()
    finally:
        server.terminate()
        try:
            server.wait(timeout=30)
        except subprocess.TimeoutExpired:
            server.kill()
    return 0


if __name__ == "__main__":
    sys.exit(main())
