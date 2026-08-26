from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import inspect

from backend import cli
from backend.config import Settings, get_settings
from backend.db.session import get_engine, reset_engines
from backend.mcp import http as mcp_http
from backend.mcp import server as mcp_server


def test_the_parser_knows_the_mcp_command(settings: Settings) -> None:
    args = cli.build_parser(settings).parse_args(["mcp"])
    assert args.command == "mcp"
    assert args.transport == "stdio"


def test_mcp_serves_stdio_over_a_migrated_database(
    settings: Settings, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    served: list[Settings] = []
    monkeypatch.setattr(mcp_server, "run_stdio", served.append)

    assert cli.main(["mcp"]) == 0
    assert served == [settings]
    assert inspect(get_engine(settings)).has_table("games")
    # stdio is the protocol's own channel: anything printed there corrupts a session.
    assert capsys.readouterr().out == ""


def test_mcp_over_http_refuses_to_start_without_a_bearer_key(
    settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    assert cli.main(["mcp", "--transport", "http"]) == 1
    assert "BLUNDERBASE_MCP_BEARER_KEY" in capsys.readouterr().out


def test_mcp_over_http_serves_the_guarded_app(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("BLUNDERBASE_MCP_BEARER_KEY", "a-key")
    get_settings.cache_clear()
    reset_engines()
    served: dict[str, Any] = {}

    def fake_run(app: Any, host: str = "", port: int = 0, **options: Any) -> None:
        served.update(app=app, host=host, port=port)

    monkeypatch.setattr("uvicorn.run", fake_run)
    assert cli.main(["mcp", "--transport", "http", "--port", "9999"]) == 0
    assert isinstance(served["app"], mcp_http.BearerGuard)
    assert (served["host"], served["port"]) == (get_settings().host, 9999)
