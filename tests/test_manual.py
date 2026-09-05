"""The built manual, served at `/manual` by the process that serves everything else.

It is the same static site that goes to blunderbase.org, mounted here so the instructions
match the version that is running and are readable on a machine with no way out — and
without a login, because the first thing an owner reads is how to choose a password.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.api.app import create_app
from backend.config import Settings
from tests.conftest import running_app

INDEX = "<!doctype html><title>Blunderbase manual</title><h1>Blunderbase</h1>"
PAGE = "<!doctype html><title>Analysis</title><h1>Analysis</h1>"
STYLE = ".md-typeset { color: #eeeeea }"
MISSING = "<!doctype html><title>Not found</title>"
SPA_INDEX = "<!doctype html><title>Blunderbase</title><div id=root></div>"


@pytest.fixture()
def manual(settings: Settings) -> Path:
    """A stand-in for `make docs`: a root index, a directory URL, an asset and a 404."""
    assert settings.manual_dir is not None
    built = settings.manual_dir
    (built / "guide" / "analysis").mkdir(parents=True)
    (built / "assets").mkdir(parents=True)
    (built / "index.html").write_text(INDEX)
    (built / "404.html").write_text(MISSING)
    (built / "guide" / "analysis" / "index.html").write_text(PAGE)
    (built / "assets" / "manual.css").write_text(STYLE)
    return built


@pytest.fixture()
def built_web(settings: Settings) -> Path:
    """The page beside it, so the SPA's catch-all has something to swallow `/manual` with."""
    assert settings.web_dist is not None
    dist = settings.web_dist
    dist.mkdir(parents=True)
    (dist / "index.html").write_text(SPA_INDEX)
    return dist


def test_the_manual_defaults_to_the_build_beside_its_source(settings: Settings) -> None:
    """`manual-site`, not `manual/site`: MkDocs refuses to build inside its own docs_dir."""
    assert settings.manual_dir == settings.root / "manual-site"


def test_the_manual_directory_can_be_pointed_elsewhere(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """What the image and the desktop bundle do, where the build is not beside the source."""
    elsewhere = tmp_path / "elsewhere" / "manual"
    monkeypatch.setenv("BLUNDERBASE_MANUAL_DIR", str(elsewhere))

    assert Settings(root=tmp_path).manual_dir == elsewhere


def test_the_manual_is_served_with_its_directory_urls(settings: Settings, manual: Path) -> None:
    """`use_directory_urls` means a page is a folder holding an `index.html`."""
    app = create_app(settings)
    assert app.state.manual is True
    with running_app(app) as client:
        assert client.get("/manual/").text == INDEX
        assert client.get("/manual/guide/analysis/").text == PAGE
        assert client.get("/manual/assets/manual.css").text == STYLE


def test_the_manual_without_a_slash_reaches_the_index(settings: Settings, manual: Path) -> None:
    """Every asset on the page is a relative URL, so the slash is not optional."""
    with running_app(create_app(settings)) as client:
        redirect = client.get("/manual", follow_redirects=False)
        assert redirect.status_code in (301, 302, 307, 308)
        assert redirect.headers["location"].endswith("/manual/")
        assert client.get("/manual").text == INDEX


def test_a_page_the_manual_does_not_have_is_its_own_404(settings: Settings, manual: Path) -> None:
    with running_app(create_app(settings)) as client:
        response = client.get("/manual/guide/nope/")

    assert response.status_code == 404
    assert response.text == MISSING


def test_the_manual_is_read_without_signing_in(settings: Settings, manual: Path) -> None:
    """It is where the owner reads how to choose the password, so it cannot be behind it."""
    with running_app(create_app(settings), password=None) as client:
        assert client.get("/manual/").text == INDEX
        assert client.get("/manual/guide/analysis/").text == PAGE
        # And the library behind it is still not readable.
        assert client.get("/api/games").status_code == 401


def test_the_page_does_not_swallow_the_manual(
    settings: Settings, manual: Path, built_web: Path
) -> None:
    """`/manual` is reserved, so the SPA's catch-all never answers it with `index.html`."""
    app = create_app(settings)
    assert app.state.web is True
    with running_app(app) as client:
        assert client.get("/").text == SPA_INDEX
        assert client.get("/manual/").text == INDEX
        assert client.get("/manual/guide/analysis/").text == PAGE


def test_the_manual_is_served_when_the_page_was_never_built(
    settings: Settings, manual: Path
) -> None:
    """Development: `pnpm dev` has the page and proxies `/manual` here."""
    app = create_app(settings)
    assert app.state.web is False
    with running_app(app) as client:
        assert client.get("/").status_code == 404
        assert client.get("/manual/").text == INDEX


def test_the_manual_carries_no_isolation_headers(settings: Settings, manual: Path) -> None:
    """It is plain HTML with no engine in it, and `require-corp` would only be a way for
    it to stop loading something one day."""
    with running_app(create_app(settings)) as client:
        page = client.get("/manual/guide/analysis/")

    assert "cross-origin-opener-policy" not in page.headers
    assert "cross-origin-embedder-policy" not in page.headers


def test_nothing_is_served_when_the_manual_was_never_built(settings: Settings) -> None:
    """`make docs` is not part of `make run`, and a missing build is not an error."""
    app = create_app(settings)
    assert app.state.manual is False
    with running_app(app) as client:
        assert client.get("/manual/").status_code == 404
