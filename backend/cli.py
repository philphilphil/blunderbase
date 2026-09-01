from __future__ import annotations

import argparse
import asyncio
import getpass
from collections.abc import Sequence
from datetime import date
from pathlib import Path
from typing import Any

from backend import __version__
from backend.config import Settings, get_settings
from backend.db.enums import JobStatus, Platform, Tier
from backend.db.migrate import upgrade_to_head
from backend.db.session import reset_engines, session_scope
from backend.services import accounts as accounts_service
from backend.services import analysis as analysis_service
from backend.services import auth as auth_service
from backend.services import backups as backups_service
from backend.services import engines as engines_service
from backend.services import explorer as explorer_service
from backend.services import games as games_service
from backend.services import import_service
from backend.services import runners as runners_service
from backend.services import stats as stats_service


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


def _date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError("expected YYYY-MM-DD") from None


def build_parser(settings: Settings | None = None) -> argparse.ArgumentParser:
    settings = settings or get_settings()
    parser = argparse.ArgumentParser(
        prog="blunderbase", description="A personal chess database with an AI coach"
    )
    # Handled while parsing, so it answers before the required subcommand is missed.
    parser.add_argument("--version", action="version", version=f"blunderbase {__version__}")
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

    accounts = commands.add_parser("accounts", help="the usernames that make a game yours")
    account_commands = accounts.add_subparsers(dest="accounts_command", required=True)
    account_commands.add_parser("list", help="every account and the games attributed to it")
    add_account = account_commands.add_parser(
        "add", help="register an account and claim the games it has already played"
    )
    add_account.add_argument("platform", choices=[str(platform) for platform in Platform])
    add_account.add_argument("username")
    account_commands.add_parser(
        "reconcile", help="re-run owner attribution over the games already stored"
    )

    runners = commands.add_parser("runners", help="the machines allowed to run engine work")
    runner_commands = runners.add_subparsers(dest="runners_command", required=True)
    runner_commands.add_parser("list", help="every runner, what it advertises and its backlog")
    create_runner = runner_commands.add_parser(
        "create", help="register a runner and print its token and runner.yaml, once"
    )
    create_runner.add_argument("name")
    create_runner.add_argument(
        "--slots", type=_positive_int, default=1, metavar="N", help="engine jobs at once"
    )
    create_runner.add_argument(
        "--server", help="how the runner reaches this server; defaults to BLUNDERBASE_PUBLIC_URL"
    )
    revoke_runner = runner_commands.add_parser(
        "revoke", help="delete a runner, its token and the engines it advertised"
    )
    revoke_runner.add_argument("name")

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

    commands.add_parser(
        "set-password",
        help="set or replace the owner's password (which is also the MCP bearer key)",
    )

    db = commands.add_parser("db", help="database maintenance")
    db_commands = db.add_subparsers(dest="db_command", required=True)
    db_commands.add_parser("upgrade", help="apply pending migrations")
    db_commands.add_parser(
        "rebuild-cards", help="recompute the stored card of every analysed game"
    )
    db_commands.add_parser(
        "rebuild-stats", help="recompute the stored stat summary of every analysed game"
    )
    db_commands.add_parser(
        "rebuild-book", help="recompute the explorer's precomputed book over every position"
    )
    backup = db_commands.add_parser(
        "backup", help="write an integrity-checked copy of the complete database"
    )
    backup.add_argument("output", type=Path, help="new .db file to create")
    backup.add_argument("--force", action="store_true", help="replace an existing output file")
    restore = db_commands.add_parser(
        "restore", help="replace the database with an integrity-checked backup"
    )
    restore.add_argument("input", type=Path, help="backup .db file to restore")
    restore.add_argument(
        "--force", action="store_true", help="replace the configured database"
    )

    demo = commands.add_parser("demo", help="build an anonymous database for screenshots")
    demo_commands = demo.add_subparsers(dest="demo_command", required=True)
    create_demo = demo_commands.add_parser(
        "create", help="copy chess facts into a separate database and fake every identity"
    )
    create_demo.add_argument(
        "--from",
        dest="source_path",
        type=Path,
        default=settings.database_path,
        help="source library; defaults to BLUNDERBASE_DB_PATH",
    )
    create_demo.add_argument(
        "--output",
        type=Path,
        default=settings.data_dir / "demo.db",
        help="new demo database; defaults to <data-dir>/demo.db",
    )
    create_demo.add_argument("--games", type=_positive_int, default=72, metavar="N")
    create_demo.add_argument(
        "--as-of", type=_date, help="newest fake game date; defaults to today"
    )
    create_demo.add_argument(
        "--force", action="store_true", help="replace an existing output database"
    )

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


def _print_accounts(rows: list[dict[str, Any]]) -> None:
    """One line per account: where it plays, who it is, and how much of the library it is."""
    if not rows:
        print("no accounts yet; `blunderbase accounts add lichess <username>` writes one")
        return
    width = max(len(row["username"]) for row in rows)
    for row in rows:
        owner = "owner" if row["is_owner"] else "other"
        print(f"{row['platform']:8} {row['username']:{width}}  {owner}  {row['games']} game(s)")


def command_accounts(args: argparse.Namespace, settings: Settings) -> int:
    """The account rows, which are the only thing that makes a stored game the owner's."""
    upgrade_to_head(settings)
    with session_scope(settings) as session:
        if args.accounts_command == "list":
            _print_accounts(accounts_service.list_accounts(session))
            return 0
        if args.accounts_command == "add":
            account, filled = accounts_service.register_and_reconcile(
                session, args.platform, args.username
            )
            print(f"{account.platform}: {account.username} is the owner's account")
        else:
            filled = accounts_service.reconcile_games(session)
        print(f"{filled.linked} game side(s) linked, {filled.colored} game(s) coloured")
        print(f"{accounts_service.unclaimed_games(session)} game(s) still belong to nobody")
    return 0


def _print_runners(rows: list[dict[str, Any]]) -> None:
    """One line per runner: what it is called, whether it is there, and what waits on it."""
    if not rows:
        print("no runners yet; `blunderbase runners create gpu-box --slots 4` registers one")
        return
    width = max(len(row["name"]) for row in rows)
    for row in rows:
        state = "connected" if row["connected"] else "offline"
        engines = ", ".join(engine["name"] for engine in row["engines"]) or "nothing advertised"
        print(
            f"{row['name']:{width}}  {state:9}  {row['slots']} slot(s)  "
            f"{row['queued_eligible']} queued  {engines}"
        )


def _runner_server_url(args: argparse.Namespace, settings: Settings) -> str:
    """What to write as `server:` in the yaml this command prints.

    Whatever was asked for, then how the deployment says it is reached, then the address
    this process would bind — which is right for a runner on the same machine and is at
    least an honest starting point for one that is not.
    """
    given = (args.server or settings.public_url).strip().rstrip("/")
    return given or f"http://{settings.host}:{settings.port}"


def command_runners(args: argparse.Namespace, settings: Settings) -> int:
    """Register, list and revoke the machines that may be handed engine work.

    `list` reads rows, so it says whether a runner was connected to the *server* — this
    process holds no links of its own. Creating one prints its token and the `runner.yaml`
    around it exactly once: only a hash is stored, so there is nothing to print a second
    time.
    """
    upgrade_to_head(settings)
    with session_scope(settings) as session:
        if args.runners_command == "list":
            _print_runners(runners_service.runner_rows(session))
            return 0
        if args.runners_command == "create":
            try:
                runner, token = runners_service.create_runner(session, args.name, args.slots)
            except runners_service.RunnerValidationError as exc:
                print(f"runners: {exc}")
                return 1
            print(f"runner {runner.name!r} registered with {runner.slots} slot(s)")
            print("This token is shown once. Save the yaml below as runner.yaml on that machine:")
            print()
            print(runners_service.config_yaml(
                runner, token, server_url=_runner_server_url(args, settings)
            ))
            return 0
        runner = runners_service.runner_by_name(session, args.name)
        if runner is None:
            print(f"runners: no runner named {args.name!r}")
            return 1
        name, runner_id = runner.name, runner.id
        runners_service.delete_runner(session, runner_id)
    print(f"runner {name!r} revoked; its token and its advertised engines are gone")
    print("A runner still connected to a running server is given no further work.")
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
                        commit=False,
                    )
                ]
            else:
                queued = analysis_service.enqueue_missing(session, tier, limit=args.limit)
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


def command_set_password(args: argparse.Namespace, settings: Settings) -> int:
    """Bootstrap or reset the password without the UI, for a headless deployment.

    Asked for twice and never echoed. It replaces whatever was there, which is the point:
    the owner who has locked themselves out cannot be asked for the old one.
    """
    upgrade_to_head(settings)
    password = getpass.getpass("New password: ")
    if password != getpass.getpass("Repeat password: "):
        print("set-password: the two entries did not match")
        return 1
    try:
        with session_scope(settings) as session:
            replaced = not auth_service.setup_required(session)
            auth_service.reset_password(session, password)
    except auth_service.AuthError as exc:
        print(f"set-password: {exc}")
        return 1
    if replaced:
        print("password replaced; every open session was signed out")
    else:
        print("password set")
    return 0


def command_db(args: argparse.Namespace, settings: Settings) -> int:
    if args.db_command == "backup":
        try:
            copied = backups_service.backup_database(
                settings.database_path, args.output, overwrite=args.force
            )
        except backups_service.BackupError as exc:
            print(f"db backup: {exc}")
            return 1
        print(f"backup: {copied.path}")
        print(
            f"{copied.bytes} bytes, schema {copied.schema_revision}, sha256 {copied.sha256}"
        )
        return 0
    if args.db_command == "restore":
        # The CLI normally runs in its own process, but disposing here also makes repeated
        # `main()` calls and embedded use stop holding the old database inode open.
        reset_engines()
        try:
            copied = backups_service.restore_database(
                args.input, settings.database_path, overwrite=args.force
            )
        except backups_service.BackupError as exc:
            print(f"db restore: {exc}")
            return 1
        reset_engines()
        print(f"restored: {copied.path}")
        print(
            f"{copied.bytes} bytes, schema {copied.schema_revision}, sha256 {copied.sha256}"
        )
        return 0
    if args.db_command == "upgrade":
        upgrade_to_head(settings)
        print(f"database at {settings.database_path} is at head")
    if args.db_command == "rebuild-cards":
        # For a library analysed before the cards existed. Everything works without it —
        # a game with no card is computed on the way out — so this only makes the games
        # table fast everywhere at once rather than one re-analysis at a time.
        upgrade_to_head(settings)
        with session_scope(settings) as session:
            rebuilt = games_service.rebuild_game_cards(session)
        print(f"rebuilt the card of {rebuilt} game(s)")
    if args.db_command == "rebuild-stats":
        # For a library analysed before the summaries existed, and the same bargain: the
        # dimensions scan the evals until this has run, so it buys speed rather than
        # correctness. The server runs the same sweep at boot; this is for doing it now.
        upgrade_to_head(settings)
        rebuilt = 0
        with session_scope(settings) as session:
            while folded := stats_service.rebuild_stat_summaries(session):
                rebuilt += folded
        print(f"rebuilt the stat summary of {rebuilt} game(s)")
    if args.db_command == "rebuild-book":
        # The explorer's own version of the same bargain: a position the book does not
        # describe is folded live, so this buys speed rather than correctness. The server
        # runs the same sweep in the background; this is for doing the whole library now.
        upgrade_to_head(settings)
        settled = 0
        with session_scope(settings) as session:
            while done := explorer_service.rebuild_position_books(session):
                settled += done
        print(f"settled the explorer book of {settled} position(s)")
    return 0


def command_demo(args: argparse.Namespace, settings: Settings) -> int:
    """Build the isolated library used for screenshots and the eventual demo mode."""
    from backend.services.demo import DemoDataError, create_demo_database

    try:
        summary = create_demo_database(
            args.source_path,
            args.output,
            game_count=args.games,
            as_of=args.as_of,
            force=args.force,
        )
    except DemoDataError as exc:
        print(f"demo: {exc}")
        return 1
    print(f"demo database: {summary.path}")
    print(
        f"{summary.games} games, {summary.analyzed} analyzed, "
        f"{summary.deep} deep, {summary.notes} notes"
    )
    print(f"serve it with BLUNDERBASE_DB_PATH={summary.path} blunderbase serve")
    return 0


COMMANDS = {
    "serve": command_serve,
    "import": command_import,
    "accounts": command_accounts,
    "runners": command_runners,
    "analyze": command_analyze,
    "mcp": command_mcp,
    "set-password": command_set_password,
    "db": command_db,
    "demo": command_demo,
}


def main(argv: Sequence[str] | None = None) -> int:
    settings = get_settings()
    args = build_parser(settings).parse_args(argv)
    return COMMANDS[args.command](args, settings)


if __name__ == "__main__":
    raise SystemExit(main())
