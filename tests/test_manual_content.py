"""The manual is documentation, so nothing but a test keeps it true.

Two things drift the moment somebody adds to the code and not to `manual/`: a new
`Settings` field nobody has to explain, and a new CLI command nobody has to write down.
Both sets are derived here from the code itself — the pydantic model and the argparse
parsers — rather than from a list kept beside them, so a setting or a command that is not
in the manual fails this test until it is.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pytest

from backend.cli import build_parser as build_app_parser
from backend.config import Settings
from backend.runners.entrypoint import build_parser as build_runner_parser

MANUAL = Path(__file__).resolve().parents[1] / "manual" / "en" / "operate"
CONFIGURATION = MANUAL / "configuration.md"
CLI = MANUAL / "cli.md"

ENV_PREFIX = "BLUNDERBASE_"


def environment_variables() -> list[str]:
    """Every `Settings` field, spelled the way an operator would set it."""
    names = []
    for name, field in Settings.model_fields.items():
        alias = field.validation_alias
        names.append(str(alias) if isinstance(alias, str) else f"{ENV_PREFIX}{name.upper()}")
    return names


def subcommands(parser: argparse.ArgumentParser, prefix: str) -> list[str]:
    """`blunderbase db backup` and friends, walked out of the parser tree.

    argparse publishes no accessor for a parser's subparsers, so the walk reads `_actions`
    — the one piece of its private API this test depends on.
    """
    found = []
    for action in parser._actions:
        if not isinstance(action, argparse._SubParsersAction):
            continue
        for name, subparser in action.choices.items():
            command = f"{prefix} {name}"
            found.append(command)
            found.extend(subcommands(subparser, command))
    return found


def runner_flags() -> list[str]:
    """Every option `blunderbase-runner` takes, `--check` and `--config` included.

    `--help` is argparse's rather than ours, and is the one flag nobody has to read about.
    """
    flags = []
    for action in build_runner_parser()._actions:
        flags.extend(
            option
            for option in action.option_strings
            if option.startswith("--") and option != "--help"
        )
    return flags


@pytest.mark.parametrize("variable", environment_variables())
def test_every_setting_is_in_the_manual(variable: str) -> None:
    assert variable in CONFIGURATION.read_text(encoding="utf-8"), (
        f"{variable} is a Settings field with nothing about it in the manual; "
        f"add a row to {CONFIGURATION.name}"
    )


@pytest.mark.parametrize("command", subcommands(build_app_parser(), "blunderbase"))
def test_every_command_is_in_the_manual(command: str) -> None:
    assert command in CLI.read_text(encoding="utf-8"), (
        f"`{command}` is a command with nothing about it in the manual; add it to {CLI.name}"
    )


@pytest.mark.parametrize("flag", runner_flags())
def test_every_runner_flag_is_in_the_manual(flag: str) -> None:
    assert flag in CLI.read_text(encoding="utf-8"), (
        f"`blunderbase-runner {flag}` is a flag with nothing about it in the manual; "
        f"add it to {CLI.name}"
    )
