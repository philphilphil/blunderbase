from __future__ import annotations

import argparse
import asyncio
from collections.abc import Sequence
from typing import Any

from backend.config import Settings, get_settings
from backend.db.enums import JobStatus, Tier
from backend.db.migrate import upgrade_to_head
from backend.db.session import session_scope
from backend.services import analysis as analysis_service
from backend.services import engines as engines_service
from backend.services import import_service


def _positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return number


def _ply_range(value: str) -> tuple[int, int]:
    """`--ply-range 40:80`: the moves a deep pass should look at, end exclusive."""
    start, separator, end = value.partition(":")
    if not separator:
        raise argparse.ArgumentTypeError("expected START:END, e.g. 40:80")
    try:
        window = (int(start), int(end))
    except ValueError:
        raise argparse.ArgumentTypeError("expected START:END, e.g. 40:80") from None
    if window[0] < 0 or window[1] <= window[0]:
        raise argparse.ArgumentTypeError("START must be below END and not negative")
    return window


def build_parser(settings: Settings | None = None) -> argparse.ArgumentParser:
    settings = settings or get_settings()
    parser = argparse.ArgumentParser(
        prog="blunderbase", description="A personal chess database with an AI coach"
    )
    commands = parser.add_subparsers(dest="command", required=True)

    serve = commands.add_parser(
        "serve", help="run the HTTP API and the analysis workers (the coach is `mcp`)"
    )
    serve.add_argument("--host", default=settings.host)
    serve.add_argument("--port", type=int, default=settings.port)
    serve.add_argument("--reload", action="store_true")

    imports = commands.add_parser("import", help="import games from a source")
    imports.add_argument("source", choices=sorted(import_service.SOURCES))
    imports.add_argument(
        "target",
        nargs="?",
        help="the PGN file to read (pgn) or the account to sync (lichess, chesscom)",
    )
    imports.add_argument("--username", help="the account to sync (lichess, chesscom)")
    imports.add_argument("--path", help="the PGN file to read (pgn)")
    imports.add_argument("--since", help="resume from this cursor instead of the stored one")
    imports.add_argument("--max-games", type=_positive_int, metavar="N", help="stop after N games")

    analyze = commands.add_parser("analyze", help="enqueue engine analysis and run the queue")
    analyze.add_argument(
        "--game-id", type=_positive_int, help="one game; omit for every pending game"
    )
    analyze.add_argument("--tier", choices=[str(tier) for tier in Tier], default=str(Tier.QUICK))
    analyze.add_argument("--fen", help="analyse one position instead of a game")
    analyze.add_argument("--ply-range", type=_ply_range, metavar="START:END")
    analyze.add_argument("--multipv", type=_positive_int, metavar="N")
    analyze.add_argument("--nodes", type=_positive_int, metavar="N")
    analyze.add_argument("--limit", type=_positive_int, metavar="N", help="queue at most N games")
    analyze.add_argument(
        "--queue-only", action="store_true", help="enqueue without running the workers"
    )
    analyze.add_argument(
        "--timeout", type=float, default=3600.0, help="give up waiting after this many seconds"
    )

    mcp = commands.add_parser("mcp", help="run the MCP coach server")
    mcp.add_argument(
        "--transport",
        choices=("stdio", "http"),
        default="stdio",
        help="stdio for a local client; http needs BLUNDERBASE_MCP_BEARER_KEY",
    )
    mcp.add_argument("--host", default=settings.host)
    mcp.add_argument("--port", type=int, default=settings.port + 1)

    db = commands.add_parser("db", help="database maintenance")
    db_commands = db.add_subparsers(dest="db_command", required=True)
    db_commands.add_parser("upgrade", help="apply pending migrations")

    return parser


def _import_options(args: argparse.Namespace) -> dict[str, Any]:
    """Only the flags the user actually passed, so an adapter sees its own defaults.

    The bare positional is whatever the source's one required argument is, so
    `import pgn game.pgn` and `import lichess owner` both read the way they are said.
    """
    names = ("username", "path", "since", "max_games")
    options = {name: getattr(args, name) for name in names if getattr(args, name) is not None}
    if args.target is not None:
        options.setdefault("path" if args.source == "pgn" else "username", args.target)
    return options


def command_serve(args: argparse.Namespace, settings: Settings) -> int:
    import uvicorn

    settings.ensure_directories()
    uvicorn.run("backend.api.app:app", host=args.host, port=args.port, reload=args.reload)
    return 0


def command_import(args: argparse.Namespace, settings: Settings) -> int:
    upgrade_to_head(settings)
    with session_scope(settings) as session:
        job = import_service.run_import(session, args.source, **_import_options(args))
        status, message = job.status, job.message
        counts = (job.games_imported, job.games_skipped, job.games_failed)
        errors = list(job.errors)
    imported, skipped, failed = counts
    print(f"{args.source}: {imported} imported, {skipped} skipped, {failed} failed")
    for error in errors:
        print(f"  {error.get('ref')}: {error.get('error')}")
    if status == JobStatus.FAILED:
        print(f"{args.source}: import failed: {message}")
        return 1
    return 0


def _print_run_event(event: dict[str, Any]) -> None:
    if event["event"] == analysis_service.EVENT_RUN_PROGRESS:
        return
    name = event["event"].removeprefix("analysis.")
    target = f"game {event['game_id']}" if event.get("game_id") else "position"
    detail = event.get("error") or (f"{event['evals']} moves" if "evals" in event else "")
    print(f"run {event['run_id']} ({target}, {event['tier']}): {name} {detail}".rstrip())


def command_analyze(args: argparse.Namespace, settings: Settings) -> int:
    """Queue the passes the flags ask for, then drain the queue in this process."""
    tier = Tier(args.tier)
    upgrade_to_head(settings)
    try:
        with session_scope(settings) as session:
            if args.fen is not None:
                queued = [
                    analysis_service.request_analysis(
                        session,
                        fen=args.fen,
                        tier=tier,
                        multipv=args.multipv,
                        nodes=args.nodes,
                        settings=settings,
                        commit=False,
                    )
                ]
            elif args.game_id is not None:
                queued = [
                    analysis_service.request_analysis(
                        session,
                        game_id=args.game_id,
                        tier=tier,
                        ply_range=args.ply_range,
                        multipv=args.multipv,
                        nodes=args.nodes,
                        settings=settings,
                        commit=False,
                    )
                ]
            else:
                queued = analysis_service.enqueue_missing(
                    session, tier, limit=args.limit, settings=settings
                )
    except (analysis_service.AnalysisRequestError, engines_service.EngineServiceError) as exc:
        print(f"analyze: {exc}")
        return 1

    print(f"queued {len(queued)} {tier} run(s)")
    if args.queue_only:
        return 0

    from backend.workers import drain

    cancel = analysis_service.subscribe(_print_run_event)
    try:
        asyncio.run(drain(settings, timeout=args.timeout))
    finally:
        cancel()

    with session_scope(settings) as session:
        outstanding = analysis_service.queue_depth(session)
    if outstanding["queued"] or outstanding["running"]:
        print(f"analyze: {outstanding['queued'] + outstanding['running']} run(s) still pending")
        return 1
    return 0


def command_mcp(args: argparse.Namespace, settings: Settings) -> int:
    """Serve the coach surface. stdio writes nothing to stdout but the protocol itself."""
    from backend.mcp.http import TransportDisabledError, run_http
    from backend.mcp.server import run_stdio

    upgrade_to_head(settings)
    if args.transport == "stdio":
        run_stdio(settings)
        return 0
    try:
        run_http(settings, host=args.host, port=args.port)
    except TransportDisabledError as exc:
        print(f"mcp: {exc}")
        return 1
    return 0


def command_db(args: argparse.Namespace, settings: Settings) -> int:
    if args.db_command == "upgrade":
        upgrade_to_head(settings)
        print(f"database at {settings.database_path} is at head")
    return 0


COMMANDS = {
    "serve": command_serve,
    "import": command_import,
    "analyze": command_analyze,
    "mcp": command_mcp,
    "db": command_db,
}


def main(argv: Sequence[str] | None = None) -> int:
    settings = get_settings()
    args = build_parser(settings).parse_args(argv)
    return COMMANDS[args.command](args, settings)


if __name__ == "__main__":
    raise SystemExit(main())
