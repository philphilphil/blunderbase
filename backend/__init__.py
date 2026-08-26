"""Blunderbase — a personal chess database with an AI coach as its centerpiece."""

from importlib.metadata import PackageNotFoundError, version

try:
    # `pyproject.toml` is the only place the number is written; this reads it back off the
    # installed distribution rather than repeating it.
    __version__ = version("blunderbase")
except PackageNotFoundError:  # a checkout that was never installed — `python -m` from a clone
    __version__ = "0+unknown"

__all__ = ["__version__"]
